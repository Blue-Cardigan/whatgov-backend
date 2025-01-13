import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';

async function createEmptyVectorStore() {
  try {
    const vectorStore = await openai.beta.vectorStores.create({
      name: "all_debates_since_04-07-2024",
      file_ids: []
    });

    logger.info('Vector store created successfully:', {
      id: vectorStore.id,
      name: vectorStore.name,
      created_at: vectorStore.created_at
    });

    return vectorStore.id;
  } catch (error) {
    logger.error('Failed to create vector store:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Execute if this is the main module
if (import.meta.url === new URL(import.meta.url).href) {
  createEmptyVectorStore()
    .then(id => console.log('Vector store ID:', id))
    .catch(console.error);
}

export { createEmptyVectorStore };