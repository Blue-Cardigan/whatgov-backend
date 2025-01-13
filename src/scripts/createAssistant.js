import { openai } from '../services/openai.js';
import { assistantPrompt } from '../utils/assistantPrompt.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

async function createParliamentaryAssistant() {
  try {
    logger.info('Creating new Parliamentary Assistant');

    const assistant = await openai.beta.assistants.create({
      name: "UK Parliamentary Debates Assistant - Weekly Debates 2025-01-06",
      instructions: assistantPrompt,
      model: "gpt-4o",
      tools: [
        { type: "file_search" }
      ],
    });

    logger.info('Successfully created assistant:', {
      id: assistant.id,
      name: assistant.name,
      model: assistant.model,
      created_at: assistant.created_at
    });
    
    return assistant;

  } catch (error) {
    logger.error('Failed to create assistant:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createParliamentaryAssistant()
    .then(assistant => {
      console.log('Assistant created successfully:', {
        id: assistant.id,
        name: assistant.name
      });
      process.exit(0);
    })
    .catch(error => {
      console.error('Failed to create assistant:', error);
      process.exit(1);
    });
}

export { createParliamentaryAssistant }; 