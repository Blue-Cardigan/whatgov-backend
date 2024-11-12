import { HansardAPI } from '../services/hansard-api.js';
import { SupabaseService } from '../services/supabase.js';
import { validateDebateContent, transformDebate, transformSpeaker } from '../utils/transforms.js';
import logger from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

const POLL_INTERVAL = 30 * 60 * 1000; // 30 minutes in milliseconds
const HOUSES = ['Commons', 'Lords'];
const OUTPUT_FILE = path.join(process.cwd(), 'src/scripts/output.json');

let stats = {
  lastRun: null,
  newDebatesFound: 0,
  debates: [],
  history: []
};

async function loadStats() {
  try {
    const data = await fs.readFile(OUTPUT_FILE, 'utf8');
    stats = JSON.parse(data);
  } catch (error) {
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(stats, null, 2), 'utf8');
  }
}

async function saveStats() {
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(stats, null, 2), 'utf8');
}

async function processDebate(debate) {
  try {
    const { data: existingDebate } = await SupabaseService.getDebateByExtId(debate.ExternalId);
    if (existingDebate) return null;

    const details = await HansardAPI.getDebateDetails(debate.ExternalId);
    if (!validateDebateContent(details.debate)) return null;

    const transformedDebate = transformDebate({
      ...details.debate,
      speakers: details.speakers.map(transformSpeaker)
    });

    await SupabaseService.upsertDebate(transformedDebate);
    stats.newDebatesFound++;

    return {
      title: transformedDebate.title,
      house: transformedDebate.house,
      type: transformedDebate.type,
      location: transformedDebate.location,
      date: transformedDebate.date
    };

  } catch (error) {
    logger.error('Failed to process debate:', error);
    return null;
  }
}

async function pollForDebates() {
  try {
    const lastProcessedDate = await SupabaseService.getLastProcessedDate();
    stats.newDebatesFound = 0;
    stats.debates = [];

    for (const house of HOUSES) {
      const debates = await HansardAPI.getDebatesList(lastProcessedDate, house);
      
      for (const debate of debates) {
        const debateDetails = await processDebate(debate);
        if (debateDetails) {
          stats.debates.push(debateDetails);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Update stats
    const run = {
      timestamp: new Date().toISOString(),
      newDebates: stats.newDebatesFound,
      debates: stats.debates
    };
    
    stats.lastRun = run.timestamp;
    stats.history = [run, ...(stats.history || [])].slice(0, 100);
    
    await saveStats();

  } catch (error) {
    logger.error('Poll failed:', error);
  }
}

async function startPolling() {
  await loadStats();
  await pollForDebates();
  setInterval(pollForDebates, POLL_INTERVAL);
}

// Handle shutdown
process.on('SIGTERM', async () => {
  await saveStats();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await saveStats();
  process.exit(0);
});

// Start polling
startPolling().catch(error => {
  logger.error('Failed to start polling:', error);
  process.exit(1);
}); 