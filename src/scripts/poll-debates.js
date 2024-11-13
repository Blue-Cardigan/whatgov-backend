import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { HansardService } from '../services/hansard.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(__dirname, 'output.json');
const POLL_INTERVAL = 30 * 60 * 1000; // 30 minutes in milliseconds

async function readOutputFile() {
  try {
    const data = await fs.readFile(OUTPUT_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // Return default structure if file doesn't exist or is invalid
    return {
      lastRun: null,
      newDebatesFound: 0,
      debates: [],
      history: []
    };
  }
}

async function writeOutputFile(data) {
  try {
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    logger.error('Failed to write output file:', error);
    throw error;
  }
}

async function pollDebates() {
  try {
    const output = await readOutputFile();
    const timestamp = new Date().toISOString();
    
    // Get latest debates
    const newDebates = await HansardService.getLatestDebates();
    
    // Create new history entry
    const historyEntry = {
      timestamp,
      newDebates: newDebates.length,
      debates: newDebates.map(debate => ({
        externalId: debate.ExternalId,
        title: debate.Title,
        ...(debate.house && { house: debate.house }),
        ...(debate.type && { type: debate.type }),
        ...(debate.location && { location: debate.location }),
        ...(debate.debateDate && { date: debate.debateDate })
      }))
    };

    // Update output object
    output.lastRun = timestamp;
    output.newDebatesFound = newDebates.length;
    output.debates = historyEntry.debates;
    output.history = [historyEntry, ...output.history];

    // Write updated data back to file
    await writeOutputFile(output);

    logger.info(`Poll completed: ${newDebates.length} new debates found`);
  } catch (error) {
    logger.error('Poll failed:', error);
  }
}

// Initial poll
pollDebates();

// Set up recurring poll
setInterval(pollDebates, POLL_INTERVAL);

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down poll-debates script');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down poll-debates script');
  process.exit(0);
}); 