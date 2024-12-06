#!/usr/bin/env node

import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';

async function deleteVectorStore(storeId) {
  if (!storeId) {
    logger.error('Please provide a vector store ID');
    process.exit(1);
  }

  try {
    // Get store details first
    const stores = await openai.beta.vectorStores.list();
    const store = stores.data.find(s => s.id === storeId);
    
    if (!store) {
      logger.error(`Vector store ${storeId} not found`);
      process.exit(1);
    }

    logger.info(`Deleting vector store: ${store.name} (${store.id})`);
    
    // Delete the store
    await openai.beta.vectorStores.del(storeId);
    logger.info(`Successfully deleted store ${storeId}`);

  } catch (error) {
    logger.error('Failed to delete vector store:', error);
    throw error;
  }
}

// Get store ID from command line argument
const storeId = process.argv[2];

// Run the script
deleteVectorStore(storeId)
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script execution failed:', error);
    process.exit(1);
  }); 