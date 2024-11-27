import { HansardService } from '../services/hansard.js';
import { HansardAPI } from '../services/hansard-api.js';
import { SupabaseService } from '../services/supabase.js';
import { processAIContent } from './aiProcessor.js';
import { calculateStats } from './statsProcessor.js';
import { transformDebate, validateDebateContent, getDebateType } from '../utils/transforms.js';
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

export async function processDebates(specificDate = null, specificDebateId = null) {
  try {
    let debatesToProcess = [];
    
    if (specificDebateId) {
      try {
        const [debate, speakers] = await Promise.all([
          HansardAPI.fetchDebate(specificDebateId),
          HansardAPI.fetchSpeakers(specificDebateId)
        ]);
        
        if (!debate) {
          throw new Error('No debate data returned');
        }

        logger.debug('Fetched specific debate:', {
          id: specificDebateId,
          title: debate.Title,
          itemCount: debate.Items?.length
        });
        
        debatesToProcess = [{
          ExternalId: specificDebateId,
          debate,
          speakers
        }];
        
      } catch (error) {
        logger.error(`Failed to fetch specific debate ${specificDebateId}:`, {
          error: error.message,
          stack: error.stack,
          status: error.status,
          response: error.response
        });
        return;
      }
    } else {
      // Get latest debates from Hansard
      debatesToProcess = await HansardService.getLatestDebates(specificDate);
    }
    
    if (!debatesToProcess?.length) {
      logger.warn('No debates found to process');
      return;
    }

    const results = {
      success: 0,
      failed: 0,
      skipped: 0
    };

    // Collect all unique member IDs across filtered debates
    const allMemberIds = new Set();
    debatesToProcess.forEach(debate => {
      debate.debate.Items
        .filter(item => item.ItemType === 'Contribution' && item.MemberId)
        .forEach(item => allMemberIds.add(item.MemberId));
    });

    // Fetch all member details from Supabase in one go
    const memberDetails = await fetchMembersFromSupabase([...allMemberIds]);
    console.log(`Members fetched: ${memberDetails.size}`);

    // Process debates in batches to avoid overwhelming APIs
    for (let i = 0; i < debatesToProcess.length; i += config.BATCH_SIZE) {
      const batch = debatesToProcess.slice(i, i + config.BATCH_SIZE);
      
      // Process batch in parallel
      const promises = batch.map(async (debate) => {
        try {
          const debateDetails = debate.debate;
          
          // Get debate type early
          const debateType = getDebateType(debateDetails.Overview);
          console.log(debateDetails.Overview);
          
          // Validate content
          const valid = validateDebateContent(debateDetails);
          if (valid === null) {
            logger.debug(`Skipping empty debate ${debate.ExternalId}`);
            results.skipped++;
            return;
          }
          
          // Process divisions first
          const divisions = await processDivisions(debate);
          logger.debug(`Processed divisions for debate ${debate.ExternalId}`, {
            divisionCount: divisions?.length
          });
          
          // Generate AI content if enabled
          let aiContent = {};
          if (config.ENABLE_AI_PROCESSING) {
            console.log(`processing AI content for debate ${debateDetails.Overview.Title}, ${debate.ExternalId}`);
            try {
              aiContent = await processAIContent(debateDetails, memberDetails, divisions, debateType);
            } catch (error) {
              logger.error('Failed to generate AI content:', {
                debateId: debate.ExternalId,
                debateTitle: debateDetails.Overview.Title,
                error: error.message,
                stack: error.stack,
                cause: error.cause
              });
            }
            
            // Update divisions with AI content if they exist
            if (divisions?.length) {
              console.log(`divisions.length: ${divisions.length}`);
              try {
                await processDivisions(debate, aiContent);
                logger.debug(`Updated divisions with AI content for debate ${debateDetails.Overview.Title}`);
              } catch (error) {
                logger.error('Failed to update divisions with AI content:', {
                  debateId: debate.ExternalId,
                  debateTitle: debateDetails.Overview.Title,
                  error: error.message,
                  stack: error.stack,
                  cause: error.cause
                });
              }
            }
          }
          
          // Calculate statistics using debate details, member info, and divisions
          const stats = await calculateStats(debateDetails, memberDetails);
          logger.debug(`Calculated stats for debate ${debate.ExternalId}`);
          
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
      if (i + config.BATCH_SIZE < debatesToProcess.length) {
        await new Promise(resolve => setTimeout(resolve, config.RETRY_DELAY));
      }
    }

    logger.info('Processing complete:', {
      processed: results.success,
      failed: results.failed,
      skipped: results.skipped,
      total: debatesToProcess.length
    });

  } catch (error) {
    logger.error('Failed to process debates:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
} 