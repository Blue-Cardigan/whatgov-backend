import { processDebates } from './processors/debateProcessor.js';
import logger from './utils/logger.js';
import fs from 'fs';
import fetch from 'node-fetch';
import { HansardService } from './services/hansard.js';
import { SupabaseService } from './services/supabase.js';
import { getDebateType } from './utils/transforms.js';

const DEFAULT_PROCESS = ['analysis'];

async function processDateRange(startDate, endDate, specificDebateId = null) {
  // If specific debate ID provided, fetch and process single debate
  if (specificDebateId) {
    logger.info(`Processing single debate: ${specificDebateId}`);
    const debateResponse = await HansardService.fetchDebate(specificDebateId);
    if (!debateResponse) {
      throw new Error(`Failed to fetch debate: ${specificDebateId}`);
    }
    
    // Process the debate through HansardService to ensure consistent formatting
    const processedDebate = await HansardService.processItems([{
      ExternalId: specificDebateId,
      Title: debateResponse.Overview.Title,
      ChildDebates: debateResponse.ChildDebates || [],
      Items: debateResponse.Items || [],
      Overview: debateResponse.Overview,
      Navigator: debateResponse.Navigator
    }]);

    if (!processedDebate?.[0]) {
      throw new Error(`Failed to process debate: ${specificDebateId}`);
    }
    
    const debate = processedDebate[0];
    
    // Add debate type to Overview before processing
    if (debate?.Overview) {
      debate.Overview.Type = getDebateType(debate.Overview);
      logger.debug('Debate type:', debate.Overview.Type);
    }
    
    logger.debug('Processing single debate:', {
      id: specificDebateId,
      type: debate.Overview.Type,
      itemCount: debate.Items?.length,
      childDebatesCount: debate.ChildDebates?.length
    });
    
    return processDebates(null, specificDebateId, DEFAULT_PROCESS, [debate]);
  }

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
        // Get all debates for this date
        const options = { specificDate: formattedDate };
        const allDebates = await HansardService.getLatestDebates(options);
        // Log total debates found
        logger.info(`Found ${allDebates.length} total debates for date: ${formattedDate}`);
        
        // Check which debates already exist in database
        const existingDebatesResults = await Promise.all(
          allDebates.map(async (debate) => {
            try {
              const result = await SupabaseService.getDebateByExtId(debate.ExternalId);
              if (result.error) {
                logger.warn(`Error checking debate existence: ${debate.ExternalId}`, {
                  error: result.error
                });
              }
              return { debate, exists: result?.data?.[0] != null };
            } catch (error) {
              logger.warn(`Failed to check debate existence: ${debate.ExternalId}`, {
                error: error.message
              });
              return { debate, exists: false };
            }
          })
        );
        
        // Log all skipped debates
        existingDebatesResults
          .filter(result => result.exists)
          .forEach(result => {
            logger.info(`Skipping existing debate: ${result.debate.ExternalId}`, {
              title: result.debate.Overview?.Title
            });
          });
        
        // Filter out existing debates
        const newDebates = existingDebatesResults
          .filter(result => !result.exists)
          .map(result => result.debate);

        if (newDebates.length === 0) {
          logger.info(`No new debates to process for date: ${formattedDate}`);
          results.push({
            date: formattedDate,
            success: true,
            skipped: true,
            totalDebates: allDebates.length,
            newDebates: 0
          });
          break;
        }

        logger.info(`Processing ${newDebates.length} new debates out of ${allDebates.length} total for date: ${formattedDate}`, {
          newDebateIds: newDebates.map(d => d.ExternalId)
        });
        
        // Process the filtered debates
        const dateResults = await processDebates(
          formattedDate,
          null,
          DEFAULT_PROCESS,
          newDebates
        );
        
        logger.info(`Successfully processed ${dateResults.length} new debates for date: ${formattedDate}`);
        results.push({
          date: formattedDate,
          success: true,
          newCount: dateResults.length,
          skippedCount: allDebates.length - newDebates.length,
          totalDebates: allDebates.length
        });
        break;
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
    if (!process.env.SCHEDULER_API_KEY) {
      logger.warn('SCHEDULER_API_KEY not set, skipping scheduler notification');
      return;
    }

    const response = await fetch('https://www.whatgov.co.uk/api/scheduler/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.SCHEDULER_API_KEY
      },
      // Add a timeout to prevent hanging
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Scheduler API responded with status: ${response.status}, body: ${errorText}`);
    }
    
    const data = await response.json();
    logger.info('Successfully notified scheduler API', { data });
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.error('Scheduler API request timed out');
    } else {
      logger.error('Failed to notify scheduler API:', {
        error: error.message,
        stack: error.stack
      });
    }
    // You might want to throw the error here depending on your needs
    // throw error;
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
      // Pass the debate ID through processDateRange instead
      results = await processDateRange(null, null, debateIdArg);
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