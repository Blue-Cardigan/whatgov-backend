import { processDebates } from './processors/debateProcessor.js';
import logger from './utils/logger.js';

async function main() {
  try {
    const testDate = process.argv[2]; // Get date from command line argument
    const debateId = process.argv[3]; // Get optional debate ID argument
    await processDebates(testDate, debateId);
  } catch (error) {
    logger.error('Failed to process debates:', error);
    process.exit(1);
  }
}

main(); 