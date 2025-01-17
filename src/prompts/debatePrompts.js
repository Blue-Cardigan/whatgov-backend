import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

// Simplified schemas with clear, focused descriptions
const SpeakerSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  party: z.string().optional(),
  constituency: z.string().optional(),
  contributions: z.array(z.string())
});

export const DebateAnalysisSchema = z.object({
  analysis: z.object({
    main_content: z.string(),
    outcome: z.string(),
    statistics: z.array(z.object({
      value: z.string(),
      context: z.string()
    }))
  }),
  speaker_points: z.array(SpeakerSchema)
});

export const debateResponseFormat = (schema = DebateAnalysisSchema) => 
  zodResponseFormat(schema, "debate_analysis");

export function getPrompt(debate) {
  return `Use your expert knowledge on UK Parliament to provide an in-depth analysis with speaker points of this ${debate.overview?.Type || ''} session. 
  
  Your main analysis should:
  1) Include all details on content and significant contributions.
  2) Be specific to the debate type.
  3) Be accurate, chronological, and comprehensive. 
  4) Include outcomes and statistics.

  Your speaker points should:
  1) Include every speaker and their details (if available), regardless of their length of contribution.
  2) Only include Party, Role, or Constituency if directly provided. If not provided, do not include.
  2) Provide a complete set of points made by each speaker, compressed into a few sentences.
  3) Be accurate, chronological, and comprehensive. 

Context:
${debate.context}

${debate.typePrompt || ''}

Provide:
1. ANALYSIS
- Comprehensive analysis
- Outcome
- Key statistics with context

2. SPEAKER ANALYSIS
For every speaker:
- Name
- Role, party, and constituency if present
- Compressed points made

Focus on accuracy and relevance. Include exact figures and dates where mentioned.`;
}

export const debateTypePrompts = {
  'Main': ``,

  'Debated Bill': `Focus on key legislative changes, contentious provisions, and likely impact.
Highlight significant amendments, outcomes of divisions, and level of cross-party support and contention.`,

  'Bill Reading': `Focus on the bill's content, the vote outcome, and party positions.`,

  'Debated Motion': `Focus on the specific proposal, voting implications, and party positions.
Highlight whether the motion is binding and its practical consequences.`,

  'Westminster Hall': `Focus on constituency impacts, ministerial responses, and backbench concerns.
Highlight any commitments or promised actions from ministers.`,

  'Prime Minister\'s Questions': `Focus on key exchanges, significant announcements, and political dynamics.
Highlight any shifts in government position or notable backbench interventions.`,

  'Department Questions': `Focus on policy announcements, ministerial commitments, and emerging issues.
Highlight any significant revelations or changes in departmental position.`,

  'Delegated Legislation': `Focus on statutory instrument details, implementation concerns, and scrutiny points.
Highlight any technical issues or practical implementation challenges raised.`,

  'Committee': `Focus on detailed scrutiny, expert evidence, and proposed improvements.
Highlight key areas of concern and cross-party agreement/disagreement.`,

  'Urgent Question': `Focus on the immediate issue, ministerial response, and follow-up scrutiny.
Highlight new information revealed and any commitments made.`,

  'Petition': `Focus on public concerns raised, government response, and proposed actions.
Highlight level of parliamentary support and likely outcomes.`,

  'Department': `Focus on policy implementation, ministerial accountability, and specific commitments.
Highlight any changes in departmental position or new initiatives.`,

  'Business Without Debate': `Focus on technical changes, administrative matters, and procedural implications.
Highlight any significant changes to parliamentary operations.`,

  'Opposition Day': `Focus on opposition critique, government defense, and alternative proposals.
Highlight voting patterns and any concessions made.`,

  'Statement': `Focus on policy announcements, immediate reactions, and implementation plans.
Highlight any shifts from previous positions or new commitments.`,

  'Question': `Focus on specific issues raised, quality of answers, and follow-up scrutiny.
Highlight any new information or commitments obtained.`,

  'Public Bill Committees': `Focus on detailed scrutiny, evidence consideration, and proposed amendments.
Highlight areas of consensus and remaining contentious issues.`,

  'Lords Chamber': `Focus on expert scrutiny, constitutional implications, and legislative improvements.
Highlight cross-party concerns and government responses.`,

  'Grand Committee': `Focus on detailed scrutiny, evidence consideration, and proposed amendments.
Highlight areas of consensus and remaining contentious issues.`
};
