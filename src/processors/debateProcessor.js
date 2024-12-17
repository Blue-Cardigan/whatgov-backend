import { HansardService } from '../services/hansard.js';
import { HansardAPI } from '../services/hansard-api.js';
import { SupabaseService } from '../services/supabase.js';
import { processAIContent } from './aiProcessor.js';
import { calculateStats } from './statsProcessor.js';
import { transformDebate } from '../utils/transforms.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import { processDivisions } from './divisionsProcessor.js';
import { createEmbeddingsForDebate } from './embeddingsProcessor.js';

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
      // Get latest debates from Hansard with options (now includes validation)
      debatesToProcess = await HansardService.getLatestDebates({
        specificDate,
        specificDebateId,
        aiProcess
      });
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
      const items = debate.Items || debate.debate?.Items || [];
      
      items
        .filter(item => item.ItemType === 'Contribution' && item.MemberId)
        .forEach(item => allMemberIds.add(item.MemberId));
      
      if (debate.ChildDebates) {
        debate.ChildDebates.forEach(childDebate => {
          const childItems = childDebate.Items || [];
          childItems
            .filter(item => item.ItemType === 'Contribution' && item.MemberId)
            .forEach(item => allMemberIds.add(item.MemberId));
        });
      }
    });

    const memberDetails = await fetchMembersFromSupabase([...allMemberIds]);
    
    logger.debug('Fetched member details:', {
      count: memberDetails.size,
      sample: Array.from(memberDetails.entries()).slice(0, 2)
    });

    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000; // 2 seconds

    async function retryUpsert(debate, aiProcess, retries = 0) {
      try {
        await SupabaseService.upsertDebate(debate, aiProcess);
        return true;
      } catch (error) {
        if (error.code === '57014' && retries < MAX_RETRIES) {
          logger.warn(`Database timeout, retrying upsert (attempt ${retries + 1}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          return retryUpsert(debate, aiProcess, retries + 1);
        }
        throw error;
      }
    }

    for (let i = 0; i < debatesToProcess.length; i += config.BATCH_SIZE) {
      const batch = debatesToProcess.slice(i, i + config.BATCH_SIZE);
      
      const promises = batch.map(async (debate) => {
        try {
          const debateDetails = debate.debate;
          const debateType = debateDetails.Overview.Type;
          
          // 1. First, get the raw divisions data
          const divisions = await processDivisions(debate);

          // 2. Generate AI content including division questions
          let aiContent;
          try {
            aiContent = await processAIContent(
              debateDetails,
              memberDetails,
              divisions,
              debateType,
              aiProcess
            );
          } catch (error) {
            logger.error('Failed to generate AI content:', error);
            results.skipped++;
            return;
          }

          // 3. Update divisions in database with AI content
          if (divisions?.length && aiContent?.divisionQuestions) {
            try {
              const updatedDivisions = divisions.map(division => {
                const aiDivisionContent = aiContent.divisionQuestions.find(
                  q => q.external_id === division.external_id
                );
                
                if (!aiDivisionContent) return division;

                return {
                  ...division,
                  ai_question: aiDivisionContent.ai_question,
                  ai_topic: aiDivisionContent.ai_topic,
                  ai_context: aiDivisionContent.ai_context,
                  ai_key_arguments: aiDivisionContent.ai_key_arguments
                };
              });

              // Single upsert with complete data
              const { error } = await SupabaseService.upsertDivisions(updatedDivisions);
              if (error) throw error;
            } catch (error) {
              logger.error('Failed to update divisions with AI content:', error);
            }
          }

          // 4. Generate and store embeddings with complete data
          if (aiContent && aiProcess?.includes('embeddings')) {
            try {
              await createEmbeddingsForDebate(
                {
                  ...debateDetails,
                  ...aiContent,
                  divisions // Pass the complete divisions data
                }, 
                memberDetails
              );
              logger.debug(`Generated embeddings for debate ${debate.ExternalId}`);
            } catch (error) {
              logger.error('Failed to generate embeddings:', error);
            }
          } else {
            logger.debug(`Skipping embedding generation for debate ${debate.ExternalId} - missing required AI content`);
          }

          const stats = await calculateStats(debateDetails, memberDetails);
          logger.debug(`Calculated stats for debate ${debate.ExternalId}`);

          try {
            const existingContent = await SupabaseService.getExistingDebateContent(debate.ExternalId);
            
            const finalDebate = transformDebate({
              ...debateDetails,
              ...stats,
              ...existingContent,
              ...aiContent
            }, memberDetails);

            await retryUpsert(finalDebate, aiProcess);
            logger.debug(`Successfully stored debate ${debate.ExternalId} in database`);
            results.success++;
          } catch (error) {
            if (error.message.includes('Failed to retrieve existing debate content')) {
              logger.error(`Skipping update to prevent data loss: ${error.message}`);
              results.skipped++;
              return;
            }
            logger.error(`Failed to store debate ${debate.ExternalId}:`, error);
            results.failed++;
          }
        } catch (error) {
          logger.error(`Failed to process debate ${debate.ExternalId}:`, error);
          results.failed++;
        }
      });

      await Promise.all(promises);
      
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
    logger.error('Failed to process debates:', error);
    throw error;
  }
} 