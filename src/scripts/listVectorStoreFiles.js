import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';

async function listVectorStoreFiles(storeId = null, options = {}) {
  try {
    if (storeId) {
      // List files for specific store with pagination
      await listFilesForStore(storeId, null, options);
    } else {
      // Get all vector stores
      const vectorStores = await openai.beta.vectorStores.list();
      
      if (!vectorStores.data.length) {
        console.log('No vector stores found');
        return;
      }

      // Process each vector store
      for (const store of vectorStores.data) {
        await listFilesForStore(store.id, store.name, options);
      }
    }
  } catch (error) {
    console.error('Failed to list vector stores:', error);
    throw error;
  }
}

async function listFilesForStore(storeId, storeName = null, options = {}) {
  try {
    const displayName = storeName ? `${storeName} (${storeId})` : storeId;
    console.log(`\nVector Store: ${displayName}`);
    
    const params = {
      limit: options.limit || 100,
      ...(options.before && { before: options.before }),
      ...(options.after && { after: options.after }),
      order: options.order || 'desc'
    };

    const files = await openai.beta.vectorStores.files.list(storeId, params);
    
    if (!files.data.length) {
      console.log('  No files in this store');
      return;
    }

    // Log file details
    console.log(`  Files: ${files.data.length}`);
    for (const file of files.data) {
      console.log(`  - ${file.id}: ${file.filename}`);
    }

    // Log pagination information if available
    if (files.has_more) {
      console.log('\n  More files available:');
      console.log(`  - Next page: Use --after ${files.data[files.data.length - 1].id}`);
      if (options.after || options.before) {
        console.log(`  - Previous page: Use --before ${files.data[0].id}`);
      }
    }
  } catch (error) {
    logger.error(`Failed to get files for store ${storeId}:`, error);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const storeId = args[0];
const options = {
  limit: 100, // Default limit
  before: null,
  after: null,
  order: 'desc'
};

// Parse additional options
for (let i = 1; i < args.length; i += 2) {
  const flag = args[i];
  const value = args[i + 1];
  
  switch (flag) {
    case '--limit':
      options.limit = Math.min(Math.max(parseInt(value, 10), 1), 100); // Ensure limit is between 1 and 100
      break;
    case '--before':
      options.before = value;
      break;
    case '--after':
      options.after = value;
      break;
    case '--order':
      options.order = value === 'asc' ? 'asc' : 'desc';
      break;
  }
}

// Run the script
listVectorStoreFiles(storeId, options)
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script execution failed:', error);
    process.exit(1);
  }); 