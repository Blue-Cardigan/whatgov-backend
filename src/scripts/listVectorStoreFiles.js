#!/usr/bin/env node

import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';

async function listVectorStoreFiles() {
  try {
    // Get all vector stores
    const vectorStores = await openai.beta.vectorStores.list();
    
    if (!vectorStores.data.length) {
      logger.info('No vector stores found');
      return;
    }

    // Process each vector store
    for (const store of vectorStores.data) {
      logger.info(`\nVector Store: ${store.name} (${store.id})`);
      
      try {
        // Get files for this store
        const files = await openai.beta.vectorStores.files.list(store.id);
        
        if (!files.data.length) {
          logger.info('  No files in this store');
          continue;
        }

        // Log file details
        logger.info(`  Files: ${files.data.length}`);
        for (const file of files.data) {
          logger.info(`  - ${file.id}: ${file.filename}`);
        }
      } catch (error) {
        logger.error(`Failed to get files for store ${store.id}:`, error);
      }
    }

  } catch (error) {
    logger.error('Failed to list vector stores:', error);
    throw error;
  }
}

// Run the script
listVectorStoreFiles()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script execution failed:', error);
    process.exit(1);
  }); 