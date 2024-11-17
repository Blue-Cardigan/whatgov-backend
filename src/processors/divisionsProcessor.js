import { HansardAPI } from '../services/hansard-api.js';
import { SupabaseService } from '../services/supabase.js';
import logger from '../utils/logger.js';
import { openai } from '../services/openai.js';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

// Define schema for division question
const DivisionQuestionSchema = z.object({
  question: z.object({
    text: z.string()
      .max(100)
      .describe('The yes/no question that MPs voted on (max 20 words)'),
    topic: z.enum([
      'Environment and Natural Resources',
      'Healthcare and Social Welfare',
      'Economy, Business, and Infrastructure',
      'Science, Technology, and Innovation',
      'Legal Affairs and Public Safety',
      'International Relations and Diplomacy',
      'Parliamentary Affairs and Governance',
      'Education, Culture, and Society'
    ]).describe('The main topic category this division falls under'),
    subtopic: z.string()
      .describe('A more specific subtopic within the main category')
  }),
  context: z.object({
    summary: z.string()
      .max(200)
      .describe('One-sentence explanation of the vote\'s significance'),
    key_arguments: z.array(z.object({
      for: z.string().describe('Key argument in favor'),
      against: z.string().describe('Key argument against')
    })).max(2).describe('Up to 2 key arguments for and against'),
    outcome_impact: z.string()
      .describe('Brief description of what the vote result means')
  })
});

async function generateDivisionQuestion(divisionData, debateText) {
  try {
    const prompt = `
Analyze this parliamentary division (vote) and provide structured information about what was being voted on.

Division Details:
- Text before vote: "${divisionData.text_before_vote}"
- Text after vote: "${divisionData.text_after_vote}"
- Result: Ayes: ${divisionData.AyesCount}, Noes: ${divisionData.NoesCount}

Relevant debate excerpt:
${debateText}

Format your response as a structured object with:
1. A clear yes/no question (max 20 words)
2. The main topic category and specific subtopic
3. Context including key arguments and impact of the outcome

Example:
{
  "question": {
    "text": "Should the UK increase its defense spending to 3% of GDP?",
    "topic": "Economy, Business, and Infrastructure",
    "subtopic": "Defense Budget"
  },
  "context": {
    "summary": "This vote determined whether to commit to NATO's recommended military spending target.",
    "key_arguments": [
      {
        "for": "Increased spending needed to meet modern security challenges",
        "against": "Current economic constraints make increase unaffordable"
      }
    ],
    "outcome_impact": "The proposal was rejected, maintaining current defense spending levels"
  }
}`;

    const response = await openai.beta.chat.completions.create({
      model: "gpt-4",
      messages: [{
        role: "system",
        content: "You are an expert in UK parliamentary procedure who specializes in making complex votes accessible to the public."
      }, {
        role: "user",
        content: prompt
      }],
      response_format: { type: "json_object" },
      schema: DivisionQuestionSchema
    });

    return response.choices[0].message.content;
  } catch (error) {
    logger.error('Failed to generate division question:', error);
    return {
      question: {
        text: '',
        topic: 'Parliamentary Affairs and Governance',
        subtopic: ''
      },
      context: {
        summary: '',
        key_arguments: [],
        outcome_impact: ''
      }
    };
  }
}

export async function processDivisions(debate) {
  try {
    const divisions = await HansardAPI.fetchDivisionsList(debate.ExternalId);
    
    if (!divisions || !divisions.length) {
      logger.debug(`No divisions found for debate ${debate.ExternalId}`);
      return null;
    }

    // Get relevant debate text for context
    const debateText = extractRelevantDebateText(debate.debate);

    const processedDivisions = await Promise.all(
      divisions.map(async (division) => {
        try {
          const divisionDetails = await HansardAPI.fetchDivisionDetails(division.ExternalId);
          
          // Generate question for this division
          const { question, context } = await generateDivisionQuestion(division, debateText);
          
          return {
            division_id: division.Id,
            external_id: division.ExternalId,
            debate_section_ext_id: debate.ExternalId,
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
            division_question: question,
            division_topic: context.summary,
            division_subtopic: context.key_arguments.map(arg => arg.for).join(', '),
            division_context: context.summary,
            division_arguments: context.key_arguments,
            division_impact: context.outcome_impact,
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
      logger.debug(`Stored ${validDivisions.length} divisions for debate ${debate.ExternalId}`);
    }

    return validDivisions;

  } catch (error) {
    logger.error(`Failed to process divisions for debate ${debate.ExternalId}:`, error);
    return null;
  }
}

function extractRelevantDebateText(debate) {
  // Get the last few contributions before the division
  const items = debate.Items || [];
  const relevantItems = items
    .filter(item => item.ItemType === 'Contribution')
    .slice(-5) // Get last 5 contributions
    .map(item => item.Value.replace(/<[^>]*>/g, '')) // Remove HTML tags
    .join('\n\n');

  return relevantItems;
} 