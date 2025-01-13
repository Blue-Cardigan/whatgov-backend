import { openai } from '../services/openai.js';
import { SupabaseService, supabase } from '../services/supabase.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

async function getAllVectorStoreFiles(storeId) {
  try {
    let allFiles = [];
    let lastFileId = null;
    
    while (true) {
      const params = {
        limit: 100,
        ...(lastFileId && { after: lastFileId }),
        order: 'asc'
      };

      const files = await openai.beta.vectorStores.files.list(storeId, params);
      
      if (!files.data.length) break;
      
      allFiles = [...allFiles, ...files.data.map(f => f.id)];
      
      if (!files.has_more) break;
      lastFileId = files.data[files.data.length - 1].id;
    }

    logger.info('Retrieved all vector store files:', {
      storeId,
      fileCount: allFiles.length
    });

    return allFiles;
  } catch (error) {
    logger.error('Failed to get vector store files:', {
      error: error.message,
      storeId
    });
    throw error;
  }
}

async function syncVectorStoreFiles(storeId) {
  try {
    logger.info('Starting vector store sync:', { storeId });

    // Get all files currently in the vector store
    const vectorStoreFiles = await getAllVectorStoreFiles(storeId);
    
    // Get all file IDs from debates_new
    const { data: debateFiles, error } = await supabase
      .from('debates_new')
      .select('file_id')
      .not('file_id', 'is', null);

    if (error) throw error;

    const debateFileIds = debateFiles.map(d => d.file_id).filter(Boolean);

    logger.info('File comparison:', {
      vectorStoreCount: vectorStoreFiles.length,
      debateFileCount: debateFileIds.length
    });

    // Find files in debates that aren't in vector store
    const missingFiles = debateFileIds.filter(
      fileId => !vectorStoreFiles.includes(fileId)
    );

    if (missingFiles.length === 0) {
      logger.info('No missing files found');
      return;
    }

    logger.info('Found missing files:', {
      count: missingFiles.length,
      files: missingFiles
    });

    // Process in batches of 100 to avoid rate limits
    const BATCH_SIZE = 100;
    for (let i = 0; i < missingFiles.length; i += BATCH_SIZE) {
      const batch = missingFiles.slice(i, i + BATCH_SIZE);
      
      logger.info(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}:`, {
        files: batch,
        remaining: missingFiles.length - (i + batch.length)
      });

      try {
        const result = await openai.beta.vectorStores.fileBatches.createAndPoll(
          storeId,
          { file_ids: batch }
        );

        logger.info('Batch processing complete:', {
          batchId: result.id,
          status: result.status,
          fileCount: batch.length
        });

      } catch (error) {
        logger.error('Failed to process batch:', {
          error: error.message,
          batch,
          storeId
        });
        // Continue with next batch even if one fails
      }

      // Add delay between batches
      if (i + BATCH_SIZE < missingFiles.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info('Sync complete:', {
      storeId,
      totalProcessed: missingFiles.length
    });

  } catch (error) {
    logger.error('Failed to sync vector store:', {
      error: error.message,
      stack: error.stack,
      storeId
    });
    throw error;
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const storeId = process.argv[2];
  
  if (!storeId) {
    console.error('Please provide a store ID');
    process.exit(1);
  }

  syncVectorStoreFiles(storeId)
    .then(() => {
      console.log('Vector store sync completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Vector store sync failed:', error);
      process.exit(1);
    });
}

export { syncVectorStoreFiles }; 