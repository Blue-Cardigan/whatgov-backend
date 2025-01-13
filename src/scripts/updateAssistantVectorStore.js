import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';

async function updateAssistantVectorStore() {
  try {
    const assistant = await openai.beta.assistants.update(
      'asst_xk2tjHDfwmk3ldHUHhx9L5KW',
      {
        tool_resources: {
          file_search: {
            vector_store_ids: ['vs_5ZL7sdqG6IPnbst8RmvmoZgv']
          }
        }
      }
    );

    console.log('Assistant vector store updated successfully');
    console.log('\nUpdated Assistant Details:');
    console.log(`  ID: ${assistant.id}`);
    console.log(`  Name: ${assistant.name}`);
    console.log(`  Vector Store IDs: ${assistant.tool_resources?.file_search?.vector_store_ids}`);

  } catch (error) {
    logger.error('Failed to update assistant vector store:', error);
    throw error;
  }
}

// Run the script
updateAssistantVectorStore()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script execution failed:', error);
    process.exit(1);
  }); 