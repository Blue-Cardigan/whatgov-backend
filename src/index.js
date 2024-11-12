import { processDebates } from './processors/debateProcessor.js';
import { config } from './config/config.js';
import logger from './utils/logger.js';

async function main() {
  try {
    await processDebates();
  } catch (error) {
    logger.error('Failed to process debates:', error);
    process.exit(1);
  }
}

main(); 