#!/usr/bin/env node

import { openai } from '../services/openai.js';
import { readFile, readdir, writeFile, access } from 'fs/promises';
import { join, parse } from 'path';
import logger from '../utils/logger.js';
import { File } from 'buffer';

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function extractMetadata(content) {
  const lines = content.split('\n');
  const metadata = {};
  
  for (const line of lines) {
    if (line.startsWith('Date: ')) {
      metadata.date = line.replace('Date: ', '').trim();
    } else if (line.startsWith('Type: ')) {
      metadata.type = line.replace('Type: ', '').trim();
    } else if (line.startsWith('House: ')) {
      metadata.house = line.replace('House: ', '').trim();
    } else if (line.startsWith('Location: ')) {
      metadata.location = line.replace('Location: ', '').trim();
    }
    
    if (metadata.date && metadata.type && metadata.house && metadata.location) {
      break;
    }
  }
  
  return metadata;
}

async function getExistingVectorStore(vectorsDir) {
  const infoPath = join(vectorsDir, 'vector-store.json');
  try {
    if (await fileExists(infoPath)) {
      const content = await readFile(infoPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    logger.warn('Could not read existing vector store info:', error);
  }
  return null;
}

async function createVectorStore() {
  try {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const mondayOffset = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
    const mondayDate = new Date(now);
    mondayDate.setUTCDate(now.getUTCDate() + mondayOffset);
    const mondayDateString = mondayDate.toISOString().split('T')[0];

    const vectorsDir = join(process.cwd(), 'vectors', mondayDateString);
    const existingStore = await getExistingVectorStore(vectorsDir);
    
    let uploadedFiles = [];
    let vectorStoreId;

    if (existingStore && existingStore.week === mondayDateString) {
      uploadedFiles = existingStore.files;
      vectorStoreId = existingStore.vectorStoreId;
      
      logger.info(`Found existing vector store ${vectorStoreId} for week ${mondayDateString}`);
      logger.info(`Currently contains ${uploadedFiles.length} files`);
    } else {
      const vectorStore = await openai.beta.vectorStores.create({
        name: `Parliamentary Debates - Week of ${mondayDateString}`,
      });
      vectorStoreId = vectorStore.id;
      logger.info(`Created new vector store with ID: ${vectorStoreId}`);
    }

    // Read and upload new files
    const files = await readdir(vectorsDir);
    const newFileIds = [];
    
    for (const file of files) {
      if (!file.endsWith('.txt')) continue;
      
      const existingFile = uploadedFiles.find(f => f.filename === file);
      if (existingFile) {
        logger.info(`File already in vector store: ${file}`);
        continue;
      }

      const filePath = join(vectorsDir, file);
      const content = await readFile(filePath, 'utf-8');
      const metadata = await extractMetadata(content);
      
      try {
        // Create a virtual file from the content
        const virtualFile = new File(
          [Buffer.from(content)],
          file,
          { type: 'text/plain' }
        );

        const uploadedFile = await openai.files.create({
          file: virtualFile,
          purpose: 'assistants'
        });
        
        logger.info(`Uploaded file: ${file} with ID: ${uploadedFile.id}`);
        newFileIds.push(uploadedFile.id);
        uploadedFiles.push({
          id: uploadedFile.id,
          filename: file,
          uploadedAt: new Date().toISOString(),
          date: metadata.date,
          type: metadata.type,
          house: metadata.house,
          location: metadata.location
        });
      } catch (error) {
        logger.error(`Failed to upload file ${file}:`, error);
        throw error;
      }
    }

    // Add files to vector store in batches of 500
    if (newFileIds.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < newFileIds.length; i += BATCH_SIZE) {
        const batch = newFileIds.slice(i, i + BATCH_SIZE);
        try {
          await openai.beta.vectorStores.fileBatches.createAndPoll(
            vectorStoreId,
            { file_ids: batch }
          );
          logger.info(`Successfully added batch of ${batch.length} files to vector store (${i + 1} to ${i + batch.length})`);
        } catch (error) {
          logger.error(`Failed to add batch to vector store:`, error);
          throw error;
        }
      }
    } else {
      logger.info('No new files to add to vector store');
    }
    
    // Save vector store details
    const vectorStoreInfo = {
      vectorStoreId,
      week: mondayDateString,
      files: uploadedFiles,
      lastUpdated: new Date().toISOString()
    };

    await writeFile(
      join(vectorsDir, 'vector-store.json'), 
      JSON.stringify(vectorStoreInfo, null, 2)
    );

    return vectorStoreInfo;
  } catch (error) {
    console.error('Detailed error:', error);
    logger.error('Failed to create vector store:', error);
    throw error;
  }
}

// Run the script
createVectorStore()
  .then(store => {
    logger.info(`Successfully created/updated vector store ${store.vectorStoreId} for week ${store.week}`);
    logger.info(`Total files: ${store.files.length}`);
  })
  .catch(error => logger.error('Script execution failed:', error));