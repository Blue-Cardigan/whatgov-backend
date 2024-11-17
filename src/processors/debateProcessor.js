import { HansardService } from '../services/hansard.js';
import { SupabaseService } from '../services/supabase.js';
import { processAIContent } from './aiProcessor.js';
import { calculateStats } from './statsProcessor.js';
import { transformDebate, validateDebateContent } from '../utils/transforms.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { processDivisions } from './divisionsProcessor.js';

async function fetchMembersFromSupabase(memberIds) {
  try {
    // Get only the fields we need
    const { data, error } = await SupabaseService.getMemberDetails(memberIds);
    
    if (error) throw error;
    
    // Create map of results with only required fields
    return new Map(
      data.map(member => [member.member_id, {
        DisplayAs: member.display_as,
        Party: member.party
      }])
    );
  } catch (error) {
    logger.error('Failed to fetch member details from Supabase:', error);
    return new Map();
  }
}

export async function processDebates(specificDate = null) {
  try {
    // Get latest debates from Hansard
    const debates = await HansardService.getLatestDebates(specificDate);
    
    if (!debates || !debates.length) {
      logger.warn('No debates found to process');
      return;
    }
    
    const results = {
      success: 0,
      failed: 0,
      skipped: 0
    };

    // Collect all unique member IDs across all debates first
    const allMemberIds = new Set();
    debates.forEach(debate => {
      debate.debate.Items
        .filter(item => item.ItemType === 'Contribution' && item.MemberId)
        .forEach(item => allMemberIds.add(item.MemberId));
    });

    // Fetch all member details from Supabase in one go
    const memberDetails = await fetchMembersFromSupabase([...allMemberIds]);

    // Process debates in batches to avoid overwhelming APIs
    for (let i = 0; i < debates.length; i += config.BATCH_SIZE) {
      const batch = debates.slice(i, i + config.BATCH_SIZE);
      
      // Process batch in parallel
      const promises = batch.map(async (debate) => {
        try {
          const debateDetails = debate.debate;
          
          // Validate content
          const valid = validateDebateContent(debateDetails);
          if (valid === null) {
            logger.debug(`Skipping empty debate ${debate.ExternalId}`);
            results.skipped++;
            return;
          }
          
          // Process divisions first to include in stats
          const divisions = await processDivisions(debate);
          logger.debug(`Processed divisions for debate ${debate.ExternalId}`);
          
          // Calculate statistics using debate details, member info, and divisions
          const stats = await calculateStats(debateDetails, memberDetails);
          logger.debug(`Calculated stats for debate ${debate.ExternalId}`);
          
          // Generate AI content if enabled
          let aiContent = {};
          if (config.ENABLE_AI_PROCESSING) {
            aiContent = await processAIContent(debateDetails, memberDetails);
            logger.debug(`Generated AI content for debate ${debate.ExternalId}`);
          }
          
          const finalDebate = transformDebate({
            ...debateDetails, 
            ...stats, 
            ...aiContent
          });
          
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