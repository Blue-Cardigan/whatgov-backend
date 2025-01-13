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
