import { HansardAPI } from '../services/hansard-api.js';
import { SupabaseService } from '../services/supabase.js';
import logger from '../utils/logger.js';

export async function processDivisions(debate, aiContent = {}) {
  try {
    const debateExternalId = debate.ExternalId;
    const debateItems = debate.Items;
    
    console.log('Starting divisions processing:', {
      debateId: debateExternalId,
      hasAiContent: !!aiContent,
      aiContentKeys: Object.keys(aiContent)
    });

    // Get divisions list for the debate
    const divisions = await HansardAPI.fetchDivisionsList(debateExternalId);
    
    if (!divisions || !divisions.length) {
      console.log(`No divisions found for debate ${debateExternalId}`);
      return null;
    }

    console.log('Found divisions:', {
      count: divisions.length,
      sampleDivision: divisions[0]
    });

    const processedDivisions = await Promise.all(
      divisions.map(async (division) => {
        try {
          // Verify the division belongs to this debate
          if (division.DebateSectionExtId !== debateExternalId) {
            logger.warn(`Division ${division.ExternalId} belongs to different debate section`, {
              divisionDebateId: division.DebateSectionExtId,
              expectedDebateId: debateExternalId
            });
            return null;
          }

          // Fetch full division details including votes
          const divisionDetails = await HansardAPI.fetchDivisionDetails(division.ExternalId);
          if (!divisionDetails) {
            logger.warn(`No division details found for ${division.ExternalId}`);
            return null;
          }
          
          // Find matching AI content for this division
          const aiDivisionContent = aiContent.divisionQuestions?.find(
            q => q.division_id === division.Id
          ) || {};

          console.log('Processing division:', {
            divisionId: division.Id,
            hasAiContent: !!aiDivisionContent,
            aiContentKeys: Object.keys(aiDivisionContent)
          });
          
          // Transform the data for storage
          const transformedDivision = {
            division_id: division.Id,
            external_id: division.ExternalId,
            debate_section_ext_id: debateExternalId,
            date: division.Date,
            time: division.Time,
            has_time: division.DivisionHasTime,
            ayes_count: division.AyesCount,
            noes_count: division.NoesCount,
            house: division.House,
            debate_section: division.DebateSection,
            debate_section_source: division.DebateSectionExtId,
            division_number: division.Number,
            text_before_vote: division.TextBeforeVote,
            text_after_vote: division.TextAfterVote,
            evel_type: division.EVELType,
            evel_info: division.EVELInfo,
            evel_ayes_count: division.EVELAyesCount,
            evel_noes_count: division.EVELNoesCount,
            is_committee_division: division.IsCommitteeDivision,
            ai_question: aiDivisionContent.ai_question || null,
            ai_topic: aiDivisionContent.ai_topic || null,
            ai_context: aiDivisionContent.ai_context || null,
            ai_key_arguments: aiDivisionContent.ai_key_arguments || {
              for: null,
              against: null
            },
            aye_members: divisionDetails.AyeMembers?.map(member => ({
              member_id: member.MemberId,
              display_as: member.DisplayAs,
              party: member.Party
            })) || [],
            noe_members: divisionDetails.NoeMembers?.map(member => ({
              member_id: member.MemberId,
              display_as: member.DisplayAs,
              party: member.Party
            })) || []
          };

          console.log('Transformed division:', {
            divisionId: transformedDivision.division_id,
            hasAiContent: !!(transformedDivision.ai_question || transformedDivision.ai_topic),
            hasMembers: transformedDivision.aye_members.length + transformedDivision.noe_members.length
          });

          return transformedDivision;
        } catch (error) {
          logger.error(`Failed to process division ${division.ExternalId}:`, error);
          return null;
        }
      })
    );

    // Filter out any failed divisions
    const validDivisions = processedDivisions.filter(d => d !== null);

    console.log('Processed divisions:', {
      total: processedDivisions.length,
      valid: validDivisions.length,
      sample: validDivisions[0]
    });

    if (validDivisions.length > 0) {
      // Store divisions in database
      const { error } = await SupabaseService.upsertDivisions(validDivisions);
      if (error) {
        logger.error(`Failed to store divisions for debate ${debateExternalId}:`, error);
        return null;
      }
      console.log(`Stored ${validDivisions.length} divisions for debate ${debateExternalId}`);
      return validDivisions;
    }

    console.log(`No valid divisions to store for debate ${debateExternalId}`);
    return null;

  } catch (error) {
    logger.error(`Failed to process divisions for debate ${debateExternalId}:`, {
      error,
      debate: debate?.ExternalId || debate?.debate?.ExternalId
    });
    return null;
  }
} 