import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

// Simplified schemas with clear, focused descriptions
const ContributionSchema = z.object({
  type: z.enum(['question-answer']),
  content: z.string(),
  references: z.array(z.object({
    text: z.string(),
    source: z.string().optional()
  })).optional()
});

const SpeakerSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  party: z.string().optional(),
  constituency: z.string().optional(),
  contributions: z.array(ContributionSchema)
});

export const DebateAnalysisSchema = z.object({
  analysis: z.object({
    main_content: z.string(),
    outcome: z.string(),
    key_statistics: z.array(z.object({
      value: z.string(),
      context: z.string()
    })),
    key_dates: z.array(z.object({
      date: z.string(),
      significance: z.string()
    }))
  }),
  speaker_points: z.array(SpeakerSchema)
});

export const debateResponseFormat = (schema = DebateAnalysisSchema) => 
  zodResponseFormat(schema, "debate_analysis");

export function getPrompt(debate) {
  return `As an expert UK parliamentary analyst, provide a briefing on this parliamentary questions session. Focus on key information and outcomes.

Context:
${debate.context.questions.map((q) => `**${q.title}**
${q.exchanges.map((e) => `${e.speaker}: ${e.text}`).join('\n')}`).join('\n\n')}

Provide:
1. ANALYSIS
- Main points, and most significant answers
- Key statistics with context
- Important dates and deadlines

2. SPEAKER ANALYSIS
For every question:
- Name, role, and party of the questioner
- The question and a summary of the answer

Focus on accuracy and relevance. Include exact figures and dates where mentioned.`;
}
