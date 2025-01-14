import { processDebates } from './processors/debateProcessor.js';
import logger from './utils/logger.js';
import fs from 'fs';
import fetch from 'node-fetch';
import { HansardService } from './services/hansard.js';

const DEFAULT_PROCESS = ['analysis'];

async function processDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const results = [];

  for (let date = start; date <= end; date.setDate(date.getDate() + 1)) {
    const formattedDate = date.toISOString().split('T')[0];
    logger.info(`Processing debates for date: ${formattedDate}`);
    
    let retryCount = 0;
    const MAX_RETRIES = 3;
    
    while (retryCount < MAX_RETRIES) {
      try {
        const dateResults = await processDebates(
          formattedDate,
          null,
          DEFAULT_PROCESS
        );
        console.log('Date results:', dateResults.length);
        results.push({
          date: formattedDate,
          success: dateResults
        });
        break; // Success, move to next date
      } catch (error) {
        retryCount++;
        if (retryCount === MAX_RETRIES) {
          logger.error(`Failed to process debates for date ${formattedDate} after ${MAX_RETRIES} attempts:`, {
            error: error.message,
            stack: error.stack
          });
          results.push({
            date: formattedDate,
            success: false,
            error: error.message
          });
        } else {
          logger.warn(`Retry ${retryCount}/${MAX_RETRIES} for date ${formattedDate}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }
    }

    // Add delay between dates to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

async function processNewDebates() {
  try {
    // Fetch the last sitting date
    const lastSittingDate = await HansardService.getLastSittingDate();

    logger.info('Processing new debates for:', {
      date: lastSittingDate
    });

    const results = await processDateRange(lastSittingDate, lastSittingDate);
    return results.some(r => r.success);
  } catch (error) {
    logger.error('Failed to process new debates:', {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

async function notifyScheduler() {
  try {
    const response = await fetch('https://whatgov.co.uk/api/scheduler/process', {
      method: 'POST',
      headers: {
        'X-API-Key': 'scheduler-api-key'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Scheduler API responded with status: ${response.status}`);
    }
    
    logger.info('Successfully notified scheduler API');
  } catch (error) {
    logger.error('Failed to notify scheduler API:', {
      error: error.message,
      stack: error.stack
    });
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);

    const debateIdArg = args.find(arg => arg.match(/^[0-9a-fA-F-]{36}$/));
    const dateArgs = args.filter(arg => 
      !arg.match(/^[0-9a-fA-F-]{36}$/) && 
      /^\d{4}-\d{2}-\d{2}$/.test(arg)
    );

    let results;

    if (debateIdArg) {
      logger.info(`Processing single debate: ${debateIdArg}`);
      results = await processDebates(null, debateIdArg, DEFAULT_PROCESS);
    }
    else if (dateArgs.length > 0) {
      const startDate = new Date(dateArgs[0]);
      const endDate = dateArgs[1] ? new Date(dateArgs[1]) : startDate;

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format. Please use YYYY-MM-DD');
      }

      if (endDate < startDate) {
        throw new Error('End date must be after start date');
      }

      logger.info('Processing date range:', {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
      });

      results = await processDateRange(startDate, endDate);
    }
    else {
      logger.info('Processing new debates');
      results = await processNewDebates();
    }

    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT, 
        `found_debates=${Boolean(results)}\n`
      );
    }

    // Add scheduler notification before exit
    await notifyScheduler();

    process.exit(results ? 0 : 1);

  } catch (error) {
    logger.error('Failed to process debates:', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

main(); 