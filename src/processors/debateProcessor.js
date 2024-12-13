import { HansardService } from '../services/hansard.js';
import { HansardAPI } from '../services/hansard-api.js';
import { SupabaseService } from '../services/supabase.js';
import { processAIContent } from './aiProcessor.js';
import { calculateStats } from './statsProcessor.js';
import { transformDebate, transformDivisions, normalizeAIContent } from '../utils/transforms.js';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
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

export async function processDebates(date = null, debateId = null, aiProcesses = null) {
  console.log('Processing debates with options:', {
    date,
    debateId,
    aiProcesses: aiProcesses?.join(', ') || 'all'
  });
  
  try {
    let debatesToProcess = [];
    
    if (debateId) {
      try {
        const [debate, speakers] = await Promise.all([
          HansardAPI.fetchDebate(debateId),
          HansardAPI.fetchSpeakers(debateId)
        ]);
        
        if (!debate) {
          throw new Error('No debate data returned');
        }

        console.log('Fetched specific debate:', {
          id: debateId,
          title: debate.Title,
          itemCount: debate.Items?.length
        });
        
        debatesToProcess = [{
          ExternalId: debateId,
          debate,
          speakers
        }];
        
      } catch (error) {
        logger.error(`Failed to fetch specific debate ${debateId}:`, {
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
        specificDate: date,
        specificDebateId: debateId,
        aiProcess: aiProcesses
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
    
    console.log('Fetched member details:', {
      count: memberDetails.size,
      sample: Array.from(memberDetails.entries()).slice(0, 2)
    });

    for (let i = 0; i < debatesToProcess.length; i += config.BATCH_SIZE) {
      const batch = debatesToProcess.slice(i, i + config.BATCH_SIZE);
      
      const promises = batch.map(async (debate) => {
        try {
          const debateDetails = debate.debate;
          const debateType = debateDetails.Overview.Type;

          // Calculate stats first
          const stats = await calculateStats(debateDetails, memberDetails);

          // Only fetch divisions if aiProcesses includes 'divisions'
          let divisions = null;
          if (aiProcesses && aiProcesses.includes('divisions') || aiProcesses.includes('all')) {
            try {
              divisions = await HansardAPI.fetchDivisionsList(debate.ExternalId);
              
              if (divisions?.length) {
                // Fetch full details for each division
                divisions = await Promise.all(
                  divisions.map(async (division) => {
                    const details = await HansardAPI.fetchDivisionDetails(division.ExternalId);
                    return {
                      ...division,
                      aye_members: details?.AyeMembers || [],
                      noe_members: details?.NoeMembers || []
                    };
                  })
                );
                
                console.log('Fetched division details:', {
                  debateId: debate.ExternalId,
                  count: divisions.length
                });
              }
            } catch (error) {
              logger.error('Failed to fetch divisions:', error);
              divisions = null;
            }
          }

          // Get existing debate data from database to preserve unmodified AI content
          const existingDebate = await SupabaseService.getDebateByExtId(debate.ExternalId);

          // Process AI content if needed
          let aiContent = null;
          if (!aiProcesses || aiProcesses.some(p => ['summary', 'questions', 'topics', 'keypoints', 'divisions', 'comments'].includes(p))) {
            aiContent = await processAIContent(
              debateDetails,
              memberDetails,
              divisions,
              debateType,
              aiProcesses
            );
          }

          console.log('Processing debate content:', {
            debateId: debate.ExternalId,
            requestedProcesses: aiProcesses,
            newAIFields: aiContent ? Object.keys(aiContent) : []
          });

          // If specific AI processes are requested, only update those fields
          if (aiProcesses) {
            try {
              // Normalize AI content field names
              const normalizedAIContent = normalizeAIContent(aiContent);

              console.log('Normalized AI content:', {
                debateId: debate.ExternalId,
                originalFields: aiContent ? Object.keys(aiContent) : [],
                normalizedFields: normalizedAIContent ? Object.keys(normalizedAIContent) : []
              });

              const updateData = {
                ext_id: debate.ExternalId,
                ...(normalizedAIContent ? Object.fromEntries(
                  Object.entries(normalizedAIContent).filter(([key]) => {
                    // Now we can use exact matches since fields are already normalized
                    if (key === 'ai_comment_thread') return aiProcesses.includes('comments');
                    if (key.startsWith('ai_title') || key.startsWith('ai_summary') || 
                        key.startsWith('ai_overview') || key.startsWith('ai_tone')) 
                      return aiProcesses.includes('summary');
                    if (key === 'ai_topics') return aiProcesses.includes('topics');
                    if (key === 'ai_key_points') return aiProcesses.includes('keypoints');
                    if (key.startsWith('ai_question')) return aiProcesses.includes('questions');
                    return false;
                  })
                ) : {})
              };

              console.log('Updating debate with AI content:', {
                debateId: debate.ExternalId,
                aiProcesses,
                fields: Object.keys(updateData),
                updateData
              });

              // Only pass divisions if we're processing division content
              const divisionsToUpdate = aiProcesses.includes('divisions') ? divisions : null;

              const { error } = await SupabaseService.upsertDebate(
                updateData, 
                aiProcesses,
                divisionsToUpdate
              );

              if (error) {
                throw new Error(`Failed to update debate: ${error.message}`);
              }

              results.success++;
            } catch (error) {
              logger.error('Failed to process AI update:', {
                error: error.message,
                stack: error.stack,
                debateId: debate.ExternalId,
                aiProcesses,
                cause: error.cause
              });
              results.failed++;
              throw error;
            }
          } else {
            // Full update - include all data
            try {
              const transformedDebate = {
                ...transformDebate(debate, debateDetails, stats),
                ...(aiContent || {})
              };

              const { error } = await SupabaseService.upsertDebate(
                transformedDebate,
                null,
                divisions
              );

              if (error) {
                throw new Error(`Failed to store debate: ${error.message}`);
              }

              logger.info('Successfully stored debate:', {
                debateId: debate.ExternalId,
                stats,
                divisionsCount: divisions?.length || 0
              });

              results.success++;
            } catch (error) {
              logger.error('Failed to store debate:', {
                error: error.message,
                stack: error.stack,
                debateId: debate.ExternalId,
                cause: error.cause
              });
              results.failed++;
              throw error;
            }
          }

          // Handle divisions separately if they're being processed
          if ((!aiProcesses || aiProcesses.includes('divisions')) && divisions?.length) {
            const transformedDivisions = divisions.map(division => {
              const newDivisionContent = aiContent?.divisionQuestions?.find(
                q => q.division_id === division.Id
              );

              if (aiProcesses) {
                // Only update division AI content
                return {
                  division_id: division.Id,
                  debate_section_ext_id: debate.ExternalId,
                  ...(newDivisionContent ? {
                    ai_question: newDivisionContent.ai_question,
                    ai_topic: newDivisionContent.ai_topic,
                    ai_context: newDivisionContent.ai_context,
                    ai_key_arguments: newDivisionContent.ai_key_arguments
                  } : {})
                };
              } else {
                // Full division update
                return {
                  ...transformDivision(division),
                  ...(newDivisionContent || {})
                };
              }
            });

            if (transformedDivisions.length) {
              await SupabaseService.upsertDivisions(transformedDivisions);
            }
          }

          // 5. Generate embeddings if requested
          if (!aiProcesses || aiProcesses.includes('embeddings') || aiProcesses.includes('all')) {
            try {
              console.log('Preparing to generate embeddings:', {
                debateId: debate.ExternalId,
                hasAiContent: !!aiContent,
                hasDivisions: !!transformedDivisions
              });

              // Prepare the debate object with all necessary content
              const debateForEmbeddings = {
                ...debateDetails,
                ...aiContent,
                divisions: transformedDivisions,
                Overview: {
                  ...debateDetails.Overview,
                  ExtId: debate.ExternalId
                }
              };

              await createEmbeddingsForDebate(
                debateForEmbeddings,
                memberDetails
              );

              logger.info('Successfully generated embeddings for debate:', {
                debateId: debate.ExternalId
              });
            } catch (error) {
              logger.error('Failed to generate embeddings:', {
                error: error.message,
                stack: error.stack,
                debateId: debate.ExternalId,
                cause: error.cause
              });
              // Continue processing - don't fail the entire debate for embedding errors
            }
          }

        } catch (error) {
          logger.error('Failed to process debate:', {
            error: error.message,
            stack: error.stack,
            debateId: debate?.ExternalId,
            cause: error.cause
          });
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