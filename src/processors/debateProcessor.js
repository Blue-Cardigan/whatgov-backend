import { HansardService } from '../services/hansard.js';
import { SupabaseService } from '../services/supabase.js';
import { processAIContent } from './aiProcessor.js';
import { calculateStats } from './statsProcessor.js';
import { transformDebate, validateDebateContent } from '../utils/transforms.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

async function fetchmemberDetails(memberId) {
  try {
    const response = await fetch(`https://hansard-api.parliament.uk/search/members.json?queryParameters.memberId=${memberId}`);
    const data = await response.json();
    return data.Results[0] || null;
  } catch (error) {
    logger.error(`Failed to fetch member ${memberId}:`, error);
    return null;
  }
}

export async function processDebates() {
  try {
    // Get latest debates from Hansard
    const debates = await HansardService.getLatestDebates();
    
    if (!debates || !debates.length) {
      logger.warn('No debates found to process');
      return;
    }
    
    const results = {
      success: 0,
      failed: 0,
      skipped: 0
    };

    // Process debates in batches to avoid overwhelming APIs
    for (let i = 0; i < debates.length; i += config.BATCH_SIZE) {
      const batch = debates.slice(i, i + config.BATCH_SIZE);
      
      // Process batch in parallel
      const promises = batch.map(async (debate) => {
        try {
        //   Check if we already have this debate
          const { data: existing } = await SupabaseService.getDebateByExtId(debate.ExternalId);
          if (existing) {
            logger.debug(`Skipping existing debate ${debate.ExternalId}`);
            results.skipped++;
            return;
          }

          const debateDetails = debate.debate; // Use existing debate details instead of fetching
          
          // Transform raw data
          const valid = validateDebateContent(debateDetails);
          
          // Skip if debate has no content
          if (valid === null) {
            logger.debug(`Skipping empty debate ${debate.ExternalId}`);
            results.skipped++;
            return;
          }
          
          // Fetch member details first
          const uniqueMembers = new Set(
            debateDetails.Items
              .filter(item => item.ItemType === 'Contribution' && item.MemberId)
              .map(item => item.MemberId)
          );

          const memberDetails = new Map();
          const memberPromises = Array.from(uniqueMembers).map(async (memberId) => {
            const details = await fetchmemberDetails(memberId);
            if (details) {
              memberDetails.set(memberId, details);
            }
          });
          await Promise.all(memberPromises);

          // Calculate statistics using the debate details and member info
          const stats = await calculateStats(debateDetails, memberDetails);
          logger.debug(`Calculated stats for debate ${debate.ExternalId}`);
          
          // Generate AI content if enabled
          let aiContent = {};
          if (config.ENABLE_AI_PROCESSING) {
            aiContent = await processAIContent(debateDetails, memberDetails);
            logger.debug(`Generated AI content for debate ${debate.ExternalId}`);
          }
          
          // Combine everything
          const finalDebate = transformDebate({...debateDetails, ...stats, ...aiContent});          
          // Store in Supabase
          await SupabaseService.upsertDebate(finalDebate);
          logger.debug(`Stored debate ${debate.ExternalId} in database`);
          
          results.success++;
        } catch (error) {
          logger.error(`Failed to process debate ${debate.ExternalId}:`, {
            error: error.message,
            stack: error.stack
          });
          results.failed++;
        }
      });

      // Wait for batch to complete
      await Promise.all(promises);
      
      // Add small delay between batches
      if (i + config.BATCH_SIZE < debates.length) {
        await new Promise(resolve => setTimeout(resolve, config.RETRY_DELAY));
      }
    }

    logger.info('Processing complete:', {
      processed: results.success,
      failed: results.failed,
      skipped: results.skipped,
      total: debates.length
    });

  } catch (error) {
    logger.error('Failed to process debates:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
} 