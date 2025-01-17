import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

export const WeeklySummarySchema = z.object({
  remarks: z.string(),
  highlights: z.array(z.object({
    title: z.string(),
    type: z.string(),
    remarks: z.string()
  }))
});

export const weeklySummaryFormat = zodResponseFormat(WeeklySummarySchema, "weekly_summary");

export function getWeeklySummaryPrompt() {
  return `As an expert in UK Parliament and a seasoned columnist, provide pithy remarks on "the week so far" in UK Parliament, using the data available on events so far this week. 
  Cover the most impactful and newsworthy items from the dates provided, with a focus on outcomes, specific Ministers, and key bills.

Requirements:
1. Provide pithy remarks on the week's key events so far (max 3 sentences)
2. List 5 highlights, with each item getting no more than 2 sentences
3. Focus on outcomes and significant developments
4. For each highlight, cite the relevant debate or event IDs

Provide:
- A summary containing the overview paragraph
- Highlights, consisting of:
  * title: The main topic or bill name
  * type: The type of parliamentary activity (e.g., "PMQs", "Debate", "Committee")
  * remarks: A 1-2 sentence description of significant content, points and outcomes
- Citation filenames at the end. These are in the format "debate-<debate_id>.txt"
`;
}
