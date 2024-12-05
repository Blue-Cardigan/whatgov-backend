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
    // Cache member details in memory for the duration of the process
    if (!global.memberDetailsCache) {
      global.memberDetailsCache = new Map();
    }

    // Filter out already cached members
    const uncachedIds = memberIds.filter(id => !global.memberDetailsCache.has(id));
    
    if (uncachedIds.length > 0) {
      const { data, error } = await SupabaseService.getMemberDetails(uncachedIds);
      if (error) throw error;
      
      // Add to cache
      data.forEach(member => {
        global.memberDetailsCache.set(member.member_id, {
          DisplayAs: member.display_as,
          MemberId: member.member_id,
          Party: member.party,
          MemberFrom: member.constituency
        });
      });
    }
    
    // Return map of requested members from cache
    return new Map(
      memberIds.map(id => [id, global.memberDetailsCache.get(id)])
        .filter(([, member]) => member !== undefined)
    );
  } catch (error) {
    logger.error('Failed to fetch member details from Supabase:', error);
    return new Map();
  }
}

export async function processDebates(specificDate = null, specificDebateId = null, aiProcess = null) {
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
        return false;
      }
    } else {
      // Get latest debates from Hansard
      debatesToProcess = await HansardService.getLatestDebates(specificDate);
    }
    
    if (!debatesToProcess?.length) {
      logger.warn('No debates found to process');
      return false;
    }

    const results = {
      success: 0,
      failed: 0,
      skipped: 0
    };

    // Collect all unique member IDs across filtered debates
    const allMemberIds = new Set();
    debatesToProcess.forEach(debate => {
      // Handle both direct Items and nested debate structure
      const items = debate.Items || debate.debate?.Items || [];
      
      items
        .filter(item => item.ItemType === 'Contribution' && item.MemberId)
        .forEach(item => allMemberIds.add(item.MemberId));
      
      // Also check child debates if they exist
      if (debate.ChildDebates) {
        debate.ChildDebates.forEach(childDebate => {
          const childItems = childDebate.Items || [];
          childItems
            .filter(item => item.ItemType === 'Contribution' && item.MemberId)
            .forEach(item => allMemberIds.add(item.MemberId));
        });
      }
    });

    // Log the structure for debugging
    logger.debug('Debate structure:', {
      sampleDebate: debatesToProcess[0] ? {
        hasItems: Boolean(debatesToProcess[0].Items),
        hasDebateItems: Boolean(debatesToProcess[0].debate?.Items),
        hasChildDebates: Boolean(debatesToProcess[0].ChildDebates),
        structure: Object.keys(debatesToProcess[0])
      } : null
    });

    // Fetch all member details from Supabase in one go
    const memberDetails = await fetchMembersFromSupabase([...allMemberIds]);
    
    logger.debug('Fetched member details:', {
      count: memberDetails.size,
      sample: Array.from(memberDetails.entries()).slice(0, 2)
    });

    // Process debates in batches to avoid overwhelming APIs
    for (let i = 0; i < debatesToProcess.length; i += config.BATCH_SIZE) {
      const batch = debatesToProcess.slice(i, i + config.BATCH_SIZE);
      
      // Process batch in parallel
      const promises = batch.map(async (debate) => {
        try {
          const debateDetails = debate.debate;
          
          // Get debate type early
          const debateType = getDebateType(debateDetails.Overview);
          
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
            divisionCount: divisions?.length,
            debateId: debate.ExternalId,
            debateTitle: debateDetails.Overview.Title
          });
          
          if (divisions === null) {
            logger.warn(`No divisions for debate ${debate.ExternalId}`);
            // Don't return/skip here, continue processing the debate
          }
          
          // Generate AI content if enabled
          let aiContent = null;
          if (config.ENABLE_AI_PROCESSING) {
            logger.debug(`Processing AI content for debate`, {
              title: debateDetails.Overview.Title,
              id: debate.ExternalId,
              memberCount: memberDetails.size,
              speakerCount: debateDetails.Items.filter(item => 
                item.ItemType === 'Contribution' && item.MemberId
              ).length
            });

            try {
              aiContent = await processAIContent(
                debateDetails,
                memberDetails,
                divisions,
                debateType,
                aiProcess
              );
            } catch (error) {
              logger.error('Failed to generate AI content:', {
                debateId: debate.ExternalId,
                debateTitle: debateDetails.Overview.Title,
                error: error.message,
                memberDetailsSize: memberDetails.size,
                sampleMember: memberDetails.get([...memberDetails.keys()][0])
              });
              results.skipped++;
              return;
            }
          }
          
          // Skip if no AI content was generated
          if (!aiContent) {
            logger.debug(`Skipping debate ${debate.ExternalId} due to missing AI content`);
            results.skipped++;
            return;
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
              // Skip this debate if division processing failed
              results.skipped++;
              return;
            }
          }
          
          // Calculate statistics using debate details, member info, and divisions
          const stats = await calculateStats(debateDetails, memberDetails);
          logger.debug(`Calculated stats for debate ${debate.ExternalId}`);
          
          const finalDebate = transformDebate({
            ...debateDetails, 
            ...stats, 
            ...aiContent,
          }, memberDetails);
          
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

    return true;

  } catch (error) {
    logger.error('Failed to process debates:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
} 