#!/usr/bin/env node

import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';

// Define your vector store ID and file IDs here
const vectorStoreId = 'vs_KX0iAngY3iPDaFldvUbseJxS';
const fileIds = [
  'file-4zE2WmRxphmjKevKzJTpb4'
];

async function addFilesToVectorStore(vectorStoreId, fileIds) {
  try {
    // Add files to vector store in batches of 500
    const BATCH_SIZE = 500;
    for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
      const batch = fileIds.slice(i, i + BATCH_SIZE);
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
    
    logger.info(`Successfully added all ${fileIds.length} files to vector store ${vectorStoreId}`);
  } catch (error) {
    logger.error('Failed to add files to vector store:', error);
    throw error;
  }
}

// Run the script
addFilesToVectorStore(vectorStoreId, fileIds)
  .catch(error => {
    logger.error('Script execution failed:', error);
    process.exit(1);
  }); 