import { processDebates } from './processors/debateProcessor.js';
import logger from './utils/logger.js';
import fs from 'fs';

async function parseDate(dateStr) {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) throw new Error('Invalid date');
    return date;
  } catch (error) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
}

async function processDateRange(startDate, endDate, aiProcess) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const results = [];

  for (let date = start; date <= end; date.setDate(date.getDate() + 1)) {
    logger.info(`Processing debates for date: ${date.toISOString().split('T')[0]}`);
    
    try {
      const dateResults = await processDebates(
        date.toISOString().split('T')[0],
        null,
        aiProcess
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

async function main() {
  try {
    const [startDateArg, endDateArg, aiProcess] = process.argv.slice(2);
    
    // Handle single debate ID case
    if (startDateArg && startDateArg.match(/^\d+$/)) {
      logger.info(`Processing single debate: ${startDateArg}`);
      const results = await processDebates(null, startDateArg, aiProcess);
      
      if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(
          process.env.GITHUB_OUTPUT, 
          `found_debates=${Boolean(results)}\n`
        );
      }
      
      process.exit(results ? 0 : 1);
    }

    // Handle date range processing
    if (startDateArg) {
      const startDate = await parseDate(startDateArg);
      const endDate = endDateArg ? await parseDate(endDateArg) : startDate;

      if (endDate < startDate) {
        throw new Error('End date must be after start date');
      }

      logger.info('Processing date range:', {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        aiProcess: aiProcess || 'all'
      });

      const results = await processDateRange(startDate, endDate, aiProcess);
      
      // Log results summary
      const summary = results.reduce((acc, result) => {
        acc[result.success ? 'success' : 'failed']++;
        return acc;
      }, { success: 0, failed: 0 });

      logger.info('Processing complete:', {
        dateRange: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
        summary,
        aiProcess: aiProcess || 'all'
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

    // Default case - process today's debates
    logger.info('Processing debates for today');
    const results = await processDebates();
    
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT, 
        `found_debates=${Boolean(results)}\n`
      );
    }

    process.exit(results ? 0 : 1);

  } catch (error) {
    logger.error('Failed to process debates:', error);
    process.exit(1);
  }
}

main(); 