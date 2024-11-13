import { processDebates } from './processors/debateProcessor.js';
import logger from './utils/logger.js';

async function main() {
  try {
    const testDate = process.argv[2]; // Get date from command line argument
    await processDebates(testDate);
  } catch (error) {
    logger.error('Failed to process debates:', error);
    process.exit(1);
  }
}

main(); 