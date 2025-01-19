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
      logger.info(`Processing event item: ${item.id}`);
      const title = eventData.event.title.replace('[HL]', '').trim();
  
      // Try full title first
      let debateResults = await searchHansard(title, item.date);
  
      // If no results, try individual terms
      if (!debateResults.length) {
        logger.info(`No results found for full title "${title}", trying individual terms`);
        
        // Split title into terms and filter out common words
        const stopWords = new Set(['of', 'and', 'the', 'in', 'on', 'at', 'to', 'for', 'with', 'by']);
        const terms = title
          .split(/\s+/)
          .filter(term => 
            term.length > 2 && 
            !stopWords.has(term.toLowerCase()) &&
            !/^\d+$/.test(term) // Skip pure numbers
          );
  
        logger.info(`Searching individual terms: ${terms.join(', ')}`);
  
        // Try each term individually
        for (const term of terms) {
          debateResults = await searchHansard(term, item.date);
          
          if (debateResults.length > 0) {
            logger.info(`Found results using term: "${term}"`);
            break;
          }
        }
      }
  
      // Update the calendar item regardless of results
      const { error: updateError } = await supabase
        .from('saved_calendar_items')
        .update({
          debate_ids: debateResults.map((d) => d.DebateSectionExtId) || [],
          is_unread: debateResults.length > 0
        })
        .eq('id', item.id);
  
      if (updateError) {
        throw updateError;
      }
  
      logger.info(
        `Processed calendar item ${item.id}: ${
          debateResults.length > 0 
            ? `found ${debateResults.length} debates` 
            : 'no debates found'
        }`
      );
  
    } catch (error) {
      logger.error(`Error processing event item ${item.id}:`, error);
      throw error;
    }
  }
  
  // Helper function to perform the Hansard search
  async function searchHansard(searchTerm, date) {
    const searchParams = new URLSearchParams({
      'queryParameters.searchTerm': searchTerm,
      'queryParameters.date': date,
      'queryParameters.startDate': date,
      'queryParameters.endDate': date
    });
  
    const url = `${HANSARD_API_BASE}/search/debates.json?${searchParams.toString()}`;
    logger.info(`Searching Hansard: ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Error fetching debate: ${await response.text()}`);
    }
  
    const data = await response.json();
    return data.Results || [];
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
      model: "gpt-4o",
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