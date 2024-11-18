import { HansardAPI } from '../services/hansard-api.js';
import { SupabaseService } from '../services/supabase.js';
import logger from '../utils/logger.js';

export async function processDivisions(debate, aiContent = {}) {
  try {
    // Get the debate's external ID from the debate object
    const debateExternalId = debate.ExternalId || debate.debate?.ExternalId;
    
    if (!debateExternalId) {
      logger.error('No external ID found for debate');
      return null;
    }

    // Get divisions list for the debate
    const divisions = await HansardAPI.fetchDivisionsList(debateExternalId);
    
    if (!divisions || !divisions.length) {
      logger.debug(`No divisions found for debate ${debateExternalId}`);
      return null;
    }

    const processedDivisions = await Promise.all(
      divisions.map(async (division) => {
        try {
          // Verify the division belongs to this debate
          if (division.DebateSectionSource !== debateExternalId) {
            logger.warn(`Division ${division.ExternalId} belongs to different debate section`, {
              divisionDebateId: division.DebateSectionSource,
              expectedDebateId: debateExternalId
            });
            return null;
          }

          // Fetch full division details including votes
          const divisionDetails = await HansardAPI.fetchDivisionDetails(division.ExternalId);
          
          // Find matching AI content for this division
          const aiDivisionContent = aiContent.division_questions?.find(
            q => q.division_id === division.Id
          ) || {};
          
          // Transform the data for storage
          return {
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
            debate_section_source: division.DebateSectionSource,
            division_number: division.Number,
            text_before_vote: division.TextBeforeVote,
            text_after_vote: division.TextAfterVote,
            evel_type: division.EVELType,
            evel_info: division.EVELInfo,
            evel_ayes_count: division.EVELAyesCount,
            evel_noes_count: division.EVELNoesCount,
            is_committee_division: division.IsCommitteeDivision,
            // Add AI-generated content
            ai_question: aiDivisionContent.question || null,
            ai_topic: aiDivisionContent.topic || null,
            ai_context: aiDivisionContent.context || null,
            ai_key_arguments: aiDivisionContent.key_arguments || null,
            // Store voting records
            aye_members: divisionDetails.AyeMembers.map(member => ({
              member_id: member.MemberId,
              display_as: member.DisplayAs,
              party: member.Party
            })),
            noe_members: divisionDetails.NoeMembers.map(member => ({
              member_id: member.MemberId,
              display_as: member.DisplayAs,
              party: member.Party
            }))
          };
        } catch (error) {
          logger.error(`Failed to process division ${division.ExternalId}:`, error);
          return null;
        }
      })
    );

    // Filter out any failed divisions
    const validDivisions = processedDivisions.filter(d => d !== null);

    if (validDivisions.length > 0) {
      // Store divisions in database
      await SupabaseService.upsertDivisions(validDivisions);
      logger.debug(`Stored ${validDivisions.length} divisions for debate ${debateExternalId}`);
    }

    return validDivisions;

  } catch (error) {
    logger.error(`Failed to process divisions for debate ${debateExternalId}:`, error);
    return null;
  }
} 