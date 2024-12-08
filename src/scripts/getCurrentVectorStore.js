#!/usr/bin/env node

import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';

async function getCurrentVectorStore() {
  try {
    // Get Monday of current week
    const mondayDate = new Date();
    mondayDate.setDate(mondayDate.getDate() - mondayDate.getDay() + 1);
    const mondayDateString = mondayDate.toISOString().split('T')[0];
    
    const storeName = `Parliamentary Debates - Week of ${mondayDateString}`;
    logger.info(`Looking for vector store: ${storeName}`);

    // Get all vector stores
    const vectorStores = await openai.beta.vectorStores.list();
    
    // Find store for current week
    const currentStore = vectorStores.data.find(store => 
      store.name === storeName
    );

    if (currentStore) {
      logger.info(`Found vector store: ${currentStore.name}`);
      logger.info(`ID: ${currentStore.id}`);
      
      // Get file count
      const files = await openai.beta.vectorStores.files.list(currentStore.id);
      logger.info(`Files: ${files.data.length}`);
      
      return currentStore.id;
    } else {
      logger.info('No vector store found for current week');
      return null;
    }

  } catch (error) {
    logger.error('Failed to get current vector store:', error);
    throw error;
  }
}

// Run the script
getCurrentVectorStore()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script execution failed:', error);
    process.exit(1);
  }); 