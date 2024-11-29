import { processDebates } from './processors/debateProcessor.js';
import logger from './utils/logger.js';
import fs from 'fs';

async function main() {
  try {
    const testDate = process.argv[2];
    const debateId = process.argv[3];
    const results = await processDebates(testDate, debateId);
    
    // Set output for GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      const foundDebates = results && results.length > 0;
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `found_debates=${foundDebates}\n`);
    }
    
    if (!results || results.length === 0) {
      logger.info('No debates found to process');
      process.exit(0);
    }
  } catch (error) {
    logger.error('Failed to process debates:', error);
    process.exit(1);
  }
}

main(); 