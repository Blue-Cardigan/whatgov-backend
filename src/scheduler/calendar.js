import { config } from '../config/config.js';
import { getPrompt, debateResponseFormat } from './debatePrompts.js';
import logger from '../utils/logger.js';
import { supabase } from '../services/supabase.js';
import { HANSARD_API_BASE } from '../services/hansard-api.js';

const openai = config.OPENAI;

export async function processCalendarItems() {
  try {
    // Get all calendar items that haven't been processed yet
    const today = new Date().toISOString().split('T')[0];
    const { data: calendarItems, error: calendarError } = await supabase
      .from('saved_calendar_items')
      .select('*')
      .is('debate_ids', null)  // Only get items that haven't been processed
      .lt('date', today)       // Only get items before today
      .order('date', { ascending: true });

    if (calendarError) {
      throw calendarError;
    }

    logger.info(`Found ${calendarItems?.length || 0} unprocessed calendar items`);

    // Process each calendar item individually
    for (const item of calendarItems || []) {
      await processCalendarItem(item);
    }

    return {
      success: true,
      processed: calendarItems?.length || 0
    };
  } catch (error) {
    logger.error('Error processing calendar items:', error);
    throw error;
  }
}

async function processCalendarItem(item) {
  try {
    const eventData = item.event_data;
    
    if (eventData.type === 'event') {
      await processEventItem(item, eventData);
    } else if (eventData.type === 'oral-questions') {
      await processOralQuestions(item, eventData);
    }
  } catch (error) {
    logger.error(`Error processing calendar item ${item.id}:`, error);
  }
}

async function processEventItem(item, eventData) {
  try {
    // Search for this debate in Hansard
    const searchParams = new URLSearchParams({
      'queryParameters.searchTerm': eventData.event.title.replace('[HL]', '').trim(),
      'queryParameters.date': item.date,
      'queryParameters.house': eventData.event.house,
      'queryParameters.startDate': eventData.event.startTime.split('T')[0],
      'queryParameters.endDate': eventData.event.endTime.split('T')[0]
    });

    const url = `${HANSARD_API_BASE}/search/debates.json?${searchParams.toString()}`;
    logger.info(`Searching for debate: ${url}`);
    
    const debateResponse = await fetch(url);
    
    if (!debateResponse.ok) {
      throw new Error(`Error fetching debate: ${await debateResponse.text()}`);
    }

    const debateData = await debateResponse.json();
    const debateResults = debateData.Results || [];

    if (debateResults.length > 0) {
      // Update the calendar item with debate IDs
      const { error: updateError } = await supabase
        .from('saved_calendar_items')
        .update({
          debate_ids: debateResults.map((d) => d.DebateSectionExtId),
          is_unread: true
        })
        .eq('id', item.id);

      if (updateError) {
        throw updateError;
      }

      logger.info(`Successfully processed calendar item ${item.id} with ${debateResults.length} debates`);
    } else {
      // Update to show we checked but found no debates
      const { error: updateError } = await supabase
        .from('saved_calendar_items')
        .update({
          debate_ids: [],
          response: `No debates found for calendar item on ${item.date}`
        })
        .eq('id', item.id);

      if (updateError) {
        throw updateError;
      }
    }
  } catch (error) {
    logger.error(`Error processing event item ${item.id}:`, error);
    throw error;
  }
}

async function processOralQuestions(item, eventData) {
  try {
    // Check if this is a whole session or individual question
    const isWholeSession = !item.event_id.includes('-q');
    let allDebateIds = [];

    // Process each oral question
    for (const question of eventData.questions) {
      const searchParams = new URLSearchParams({
        'queryParameters.searchTerm': question.text,
        'queryParameters.startDate': item.date,
        'queryParameters.endDate': item.date
      });

      const url = `${HANSARD_API_BASE}/search.json?${searchParams.toString()}`;
      logger.info(`Searching for oral question: ${url}`);
      
      const questionResponse = await fetch(url);
      
      if (!questionResponse.ok) {
        throw new Error(`Error fetching oral question: ${await questionResponse.text()}`);
      }

      const questionData = await questionResponse.json();
      const debateIds = questionData.Contributions?.map((c) => c.DebateSectionExtId) || [];
      allDebateIds.push(...debateIds);

      // If we found any debates and this is a whole session, fetch the top-level debate
      if (isWholeSession && debateIds.length > 0) {
        const topLevelId = await fetchTopLevelDebateId(debateIds[0]);
        if (topLevelId) {
          allDebateIds = [topLevelId];
          await processWholeSession(item, eventData, topLevelId);
          break; // We only need one top-level ID for the whole session
        }
      }
    }

    // Update the calendar item
    const { error: updateError } = await supabase
      .from('saved_calendar_items')
      .update({
        debate_ids: allDebateIds,
      })
      .eq('id', item.id);

    if (updateError) {
      throw updateError;
    }

    logger.info(`Successfully processed ${isWholeSession ? 'session' : 'question'} with ${allDebateIds.length} debates`);
  } catch (error) {
    logger.error(`Error processing oral questions for item ${item.id}:`, error);
    throw error;
  }
}

async function fetchTopLevelDebateId(debateId) {
  try {
    const topLevelUrl = `${HANSARD_API_BASE}/debates/topleveldebateid/${debateId}.json`;
    const topLevelResponse = await fetch(topLevelUrl);

    if (topLevelResponse.ok) {
      const topLevelId = await topLevelResponse.text();
      if (topLevelId) {
        return topLevelId.replace(/['"]/g, '');
      }
    }
    return null;
  } catch (error) {
    logger.error(`Error fetching top-level debate ID:`, error);
    return null;
  }
}

async function processWholeSession(item, eventData, topLevelId) {
  try {
    // Fetch the full debate content
    const debateUrl = `${HANSARD_API_BASE}/debates/debate/${topLevelId}.json`;
    const debateResponse = await fetch(debateUrl);
    
    if (!debateResponse.ok) {
      throw new Error(`Failed to fetch debate content: ${debateResponse.status}`);
    }

    const debateContent = await debateResponse.json();
    
    // Extract all child debates (individual questions)
    const childDebates = debateContent.ChildDebates?.flatMap((dept) => 
      dept.ChildDebates?.map((question) => ({
        title: question.Overview.Title,
        exchanges: question.Items?.map((item) => ({
          speaker: item.AttributedTo,
          text: item.Value.replace(/<[^>]*>/g, ''), // Strip HTML tags
          isQuestion: item.HRSTag === 'Question'
        }))
      }))
    ).filter(Boolean) || [];

    // Generate AI analysis
    const questionPrompt = getPrompt({
      overview: {
        Type: 'Department Questions',
        Title: debateContent.Overview.Title,
        House: debateContent.Overview.House,
        Date: debateContent.Overview.Date
      },
      context: {
        department: eventData.department,
        questions: childDebates.map((d) => ({
          title: d.title,
          exchanges: d.exchanges
        }))
      }
    });

    // Create completion request
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert parliamentary analyst specializing in oral questions analysis."
        },
        {
          role: "user",
          content: questionPrompt
        }
      ],
      response_format: debateResponseFormat(),
      temperature: 0.3
    });

    if (completion.choices[0]?.message?.content) {
      const analysisResponse = JSON.parse(completion.choices[0].message.content);
      
      // Insert into debates_new table with structured analysis
      const { error: debateError } = await supabase
        .from('debates_new')
        .insert({
          ext_id: topLevelId,
          title: `${eventData.department} Oral Questions`,
          type: 'Question',
          house: 'Commons',
          date: item.date,
          analysis: analysisResponse.analysis,
          speaker_points: analysisResponse.speaker_points,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (debateError) {
        throw debateError;
      }

      logger.info(`Successfully stored analysis for debate ${topLevelId}`);
    }
  } catch (error) {
    logger.error(`Error processing whole session:`, error);
    throw error;
  }
}

// Utility function to sanitize debate IDs
function sanitizeDebateId(id) {
  return id.trim().replace(/['"]/g, '');
}