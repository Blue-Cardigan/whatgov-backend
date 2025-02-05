import { config } from '../config/config.js';
import { supabase } from '../services/supabase.js';
import { getDailySummaryPrompt, dailySummaryFormat } from './dailyPrompts.js';
import logger from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

const openai = config.OPENAI;

export async function processDailySummary() {
  logger.info('Starting daily summary generation');
  
  // Get current week's Monday
  const currentDate = new Date();
  const diff = currentDate.getDate() - currentDate.getDay() + (currentDate.getDay() === 0 ? -6 : 1);
  const monday = new Date(currentDate.setDate(diff));
  const mondayString = monday.toISOString().split('T')[0];

  // Get the weekly assistant ID
  let assistantId = process.env.WEEKLY_OPENAI_ASSISTANT_ID;

  try {
    // Create a thread
    const thread = await openai.beta.threads.create();
    console.log(`[Scheduler] Created thread ${thread.id} for daily summary using assistant ${assistantId}`);

    // Add the message to the thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: getDailySummaryPrompt()
    });

    // Run the assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
      instructions: "Generate a daily summary following the format exactly. Ensure all citations are included.",
      response_format: dailySummaryFormat
    });

    console.log(getDailySummaryPrompt())

    // Wait for completion
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    while (runStatus.status !== 'completed') {
      if (runStatus.status === 'failed' || runStatus.status === 'cancelled') {
        throw new Error(`Run ${runStatus.status}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    const messages = await openai.beta.threads.messages.list(thread.id);
    const assistantMessage = messages.data.find(msg => msg.role === 'assistant');
    
    if (!assistantMessage?.content[0] || assistantMessage.content[0].type !== 'text') {
      throw new Error('Invalid assistant response');
    }

    const response = JSON.parse(assistantMessage.content[0].text.value);
    const citations = [];

    // Extract citations if any
    if ('annotations' in assistantMessage.content[0].text) {
      for (const annotation of assistantMessage.content[0].text.annotations) {
        if ('file_citation' in annotation) {
          const citedFile = await openai.files.retrieve(annotation.file_citation.file_id);
          citations.push(citedFile.filename.replace('.txt', '').replace('debate-', ''));
        }
      }
    }

    // Store the daily summary
    const currentHour = new Date().getHours();
    const timeOfDay = currentHour < 12.30 ? 'am' : 'pm';
    const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];
    const weekdayTime = `${weekday}_${timeOfDay}`;
    
    const { error: summaryError } = await supabase
      .from('frontpage_weekly')
      .upsert({
        week_start: mondayString,
        week_end: new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        remarks: response.remarks,
        highlights: response.highlights,
        citations: citations,
        is_published: true,
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        weekday: weekdayTime
      });

    if (summaryError) {
      throw summaryError;
    }
    
    logger.info('Successfully generated and stored weekly summary');
    return true;
  } catch (error) {
    logger.error('Error generating weekly summary:', error);
    throw error;
  }
}