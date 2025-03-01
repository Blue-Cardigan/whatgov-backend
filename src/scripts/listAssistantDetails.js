#!/usr/bin/env node

import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';

async function listAssistantDetails() {
  try {
    const assistant = await openai.beta.assistants.retrieve(
      'asst_jds8X7sdmuqKflp02hwXvzrE'
    );

    logger.info('raw assistant', assistant);
    
    logger.info('\nAssistant Details:');
    logger.info(`  ID: ${assistant.id}`);
    logger.info(`  Name: ${assistant.name}`);
    logger.info(`  Model: ${assistant.model}`);
    logger.info(`  Description: ${assistant.description}`);
    logger.info(`  Created: ${new Date(assistant.created_at * 1000).toLocaleString()}`);
    logger.info(`  Instructions: ${assistant.instructions}`);
    logger.info(`  Vector Store IDs: ${assistant.tool_resources?.file_search?.vector_store_ids}`);
    
    if (assistant.tools && assistant.tools.length) {
      logger.info('\nTools:');
      assistant.tools.forEach(tool => {
        logger.info(`  - ${tool.type}`);
      });
    }

  } catch (error) {
    logger.error('Failed to retrieve assistant details:', error);
    throw error;
  }
}

// Run the script
listAssistantDetails()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script execution failed:', error);
    process.exit(1);
  }); 