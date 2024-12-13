import { HansardAPI } from '../services/hansard-api.js';
import logger from '../utils/logger.js';

export async function processDivisions(debate) {
  try {
    const debateExternalId = debate.ExternalId;
    const debateItems = debate.Items;
    
    logger.debug('Fetching divisions for debate:', {
      externalId: debateExternalId,
      hasItems: !!debateItems,
      itemsCount: debateItems?.length
    });

    // Get divisions list for the debate
    const divisions = await HansardAPI.fetchDivisionsList(debateExternalId);
    console.log(`${divisions.length} divisions found`);
    
    if (!divisions || !divisions.length) {
      logger.debug(`No divisions found for debate ${debateExternalId}`);
      return null;
    }

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
          
          // Transform the data without AI content
          return {
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
        } catch (error) {
          logger.error(`Failed to process division ${division.ExternalId}:`, error);
          return null;
        }
      })
    );

    // Filter out any failed divisions
    const validDivisions = processedDivisions.filter(d => d !== null);

    if (validDivisions.length > 0) {
      logger.debug(`Processed ${validDivisions.length} divisions for debate ${debateExternalId}`);
      return validDivisions;
    }

    logger.debug(`No valid divisions found for debate ${debateExternalId}`);
    return null;

  } catch (error) {
    logger.error(`Failed to process divisions for debate ${debateExternalId}:`, {
      error,
      debate: debate?.ExternalId || debate?.debate?.ExternalId
    });
    return null;
  }
}