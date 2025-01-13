#!/usr/bin/env node

import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';
import { assistantPrompt } from '../utils/assistantPrompt.js';

async function updateAssistantInstructions() {
  const ASSISTANT_ID = 'asst_qVQP4gTRYIeZLXSPy5csWlpe';
  
  try {
    // Read the instructions from the local file
    const instructions = assistantPrompt;

    console.log('Updating assistant instructions:', {
      assistantId: ASSISTANT_ID,
      instructionsLength: instructions.length
    });

    // Update the assistant
    const updatedAssistant = await openai.beta.assistants.update(
      ASSISTANT_ID,
      {
        instructions,
        model: 'gpt-4o',  // Update to latest model
        tools: [
          { type: 'file_search' }
        ],
        tool_resources: {
          file_search: {
            vector_store_ids: ['vs_3R5Unz1iS6bKaUcet2DQcRmF']
          }
        }
      }
    );

    logger.info('Successfully updated assistant:', {
      id: updatedAssistant.id,
      name: updatedAssistant.name,
      model: updatedAssistant.model,
      toolCount: updatedAssistant.tools.length,
      instructionsLength: updatedAssistant.instructions.length,
      updatedAt: new Date(updatedAssistant.created_at * 1000).toLocaleString()
    });

  } catch (error) {
    logger.error('Failed to update assistant:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Run the script
updateAssistantInstructions()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script execution failed:', error);
    process.exit(1);
  }); 