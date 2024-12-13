import { processDebates } from './processors/debateProcessor.js';
import logger from './utils/logger.js';
import fs from 'fs';
import { SupabaseService } from './services/supabase.js';
import { HansardAPI } from './services/hansard-api.js';

const VALID_AI_PROCESSES = ['summary', 'questions', 'topics', 'keypoints', 'divisions', 'comments', 'embeddings'];

async function processDateRange(startDate, endDate, aiProcess) {
  const processesToRun = aiProcess?.length > 0 ? aiProcess : VALID_AI_PROCESSES;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const results = [];

  for (let date = start; date <= end; date.setDate(date.getDate() + 1)) {
    logger.info(`Processing debates for date: ${date.toISOString().split('T')[0]}`);
    
    try {
      const dateResults = await processDebates(
        date.toISOString().split('T')[0],
        null,
        processesToRun
      );
      results.push({
        date: date.toISOString().split('T')[0],
        success: dateResults
      });
    } catch (error) {
      logger.error(`Failed to process debates for date ${date.toISOString().split('T')[0]}:`, error);
      results.push({
        date: date.toISOString().split('T')[0],
        success: false,
        error: error.message
      });
    }

    // Add delay between dates to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
}

async function processDebatesWithMissingContent(aiProcess = null) {
  const processesToRun = aiProcess?.length > 0 ? aiProcess : VALID_AI_PROCESSES;
  try {
    const PAGE_SIZE = 10;
    let startRange = 0;
    let hasMore = true;
    let totalProcessed = 0;
    let successCount = 0;
    let failureCount = 0;

    while (hasMore) {
      // Get debates with missing AI content from Supabase
      const { data: debatesWithMissingContent, error, hasMore: moreResults } = 
        await SupabaseService.getDebatesWithMissingContent(PAGE_SIZE, startRange);
      
      if (error) throw error;
      
      if (!debatesWithMissingContent?.length) {
        logger.info('No more debates found with missing AI content');
        break;
      }

      logger.info(`Processing batch of ${debatesWithMissingContent.length} debates (range: ${startRange}-${startRange + PAGE_SIZE - 1})`);

      // Process each debate in the current batch
      for (const debate of debatesWithMissingContent) {
        try {
          // Fetch full debate data from Hansard API
          const [debateDetails, speakers] = await Promise.all([
            HansardAPI.fetchDebate(debate.ext_id),
            HansardAPI.fetchSpeakers(debate.ext_id)
          ]);

          if (!debateDetails) {
            logger.warn(`No debate data returned for ${debate.ext_id}`);
            failureCount++;
            continue;
          }

          // Process the debate with existing machinery
          await processDebates(null, debate.ext_id, processesToRun);
          successCount++;
          
        } catch (error) {
          logger.error(`Failed to process debate ${debate.ext_id}:`, {
            error: error.message,
            stack: error.stack
          });
          failureCount++;
        }
      }

      totalProcessed += debatesWithMissingContent.length;
      hasMore = moreResults;
      startRange += PAGE_SIZE;

      // Log progress
      logger.info('Batch processing complete:', {
        processed: totalProcessed,
        successful: successCount,
        failed: failureCount,
        hasMore
      });

      // Add a small delay between batches to avoid overwhelming the API
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info('Completed processing all debates with missing content:', {
      totalProcessed,
      successful: successCount,
      failed: failureCount
    });

    return successCount > 0;
  } catch (error) {
    logger.error('Failed to process debates with missing content:', {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    
    // Find the debate ID (if present)
    const debateIdArg = args.find(arg => arg.match(/^[0-9a-fA-F-]{36}$/));
    
    // Find ALL AI processes (if present)
    const aiProcessArgs = args.filter(arg => VALID_AI_PROCESSES.includes(arg));
    
    // Find date arguments (any remaining args that match date format)
    const dateArgs = args.filter(arg => 
      !arg.match(/^[0-9a-fA-F-]{36}$/) && 
      !VALID_AI_PROCESSES.includes(arg) &&
      /^\d{4}-\d{2}-\d{2}$/.test(arg)  // Add explicit date format check
    );

    // Validate aiProcesses if provided
    if (aiProcessArgs.length > 0) {
      const invalidProcesses = aiProcessArgs.filter(proc => !VALID_AI_PROCESSES.includes(proc));
      if (invalidProcesses.length > 0) {
        throw new Error(`Invalid AI process(es): ${invalidProcesses.join(', ')}. Must be one of: ${VALID_AI_PROCESSES.join(', ')}`);
      }
    }

    if (debateIdArg) {
      // If no AI processes specified, use all of them
      const processesToRun = aiProcessArgs.length > 0 ? aiProcessArgs : VALID_AI_PROCESSES;
      
      logger.info(`Processing single debate: ${debateIdArg}`, { aiProcesses: processesToRun });
      const results = await processDebates(null, debateIdArg, processesToRun);
      
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(
          process.env.GITHUB_OUTPUT, 
          `found_debates=${Boolean(results)}\n`
        );
      }
      
      process.exit(results ? 0 : 1);
    }

    // Handle date range processing
    if (dateArgs.length > 0) {
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
        endDate: endDate.toISOString().split('T')[0],
        aiProcess: aiProcessArgs || 'all'
      });

      const results = await processDateRange(startDate, endDate, aiProcessArgs);
      
      // Log results summary
      const summary = results.reduce((acc, result) => {
        acc[result.success ? 'success' : 'failed']++;
        return acc;
      }, { success: 0, failed: 0 });

      logger.info('Processing complete:', {
        dateRange: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
        summary,
        aiProcess: aiProcessArgs || 'all'
      });

      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(
          process.env.GITHUB_OUTPUT, 
          `found_debates=${results.some(r => r.success)}\n`
        );
      }

      // Exit with failure if no successful processing
      process.exit(summary.success > 0 ? 0 : 1);
    }

    // Default case - process debates with missing content
    logger.info('Processing debates with missing AI content');
    const results = await processDebatesWithMissingContent(aiProcessArgs);
    
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT, 
        `found_debates=${Boolean(results)}\n`
      );
    }

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