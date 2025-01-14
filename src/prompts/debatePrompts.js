import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

// Simplified schemas with clear, focused descriptions
const ContributionSchema = z.object({
  type: z.enum(['key_point', 'question', 'response']),
  content: z.string(),
  references: z.array(z.object({
    text: z.string(),
    source: z.string().optional()
  })).optional()
});

const SpeakerSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  party: z.string(),
  contributions: z.array(ContributionSchema)
});

export const DebateAnalysisSchema = z.object({
  analysis: z.object({
    main_points: z.string(),
    outcome: z.string(),
    statistics: z.array(z.object({
      value: z.string(),
      context: z.string()
    })),
    dates: z.array(z.object({
      date: z.string(),
      significance: z.string()
    }))
  }),
  speakers: z.array(SpeakerSchema)
});

export const debateResponseFormat = (schema = DebateAnalysisSchema) => 
  zodResponseFormat(schema, "debate_analysis");

export function getPrompt(debate) {
  return `As an expert UK parliamentary analyst, provide a briefing on this ${debate.overview?.Type || ''} parliamentary session. Focus on key information and outcomes.

Context:
${debate.context}

${debate.typePrompt || ''}

Provide:
1. ANALYSIS
- Main points, overall structure, and outcomes
- Key statistics with context
- Important dates and deadlines

2. SPEAKER ANALYSIS
For every speaker:
- Name, role, and party
- All points made
- Highlight most notable points, questions, responses, and commitments

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
