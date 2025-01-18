import { config } from '../config/config.js';
import { supabase } from '../services/supabase.js';
import { processDailySummary } from './dailySummary.js';
import { processCalendarItems } from './calendar.js';
import { calculateNextRunDate } from './schedulerUtils.js';
import { getLastSevenDays } from '../utils/debateUtils.js';
import logger from '../utils/logger.js';
import { HANSARD_API_BASE } from '../services/hansard-api.js';

const openai = config.OPENAI;

export async function processScheduledSearches(searchType) {
  try {
    logger.info('Starting scheduled search processing');

    // Process weekly summary if needed
    if (!searchType || searchType === 'frontpage') {
      await processDailySummary();
    }

    // Process calendar items if needed
    if (searchType === 'calendar') {
      return await processCalendarItems();
    }

    // Process regular searches
    const schedules = await fetchSchedules(searchType);
    await processSchedules(schedules);

    logger.info('Completed processing all schedules');
    return { success: true };

  } catch (error) {
    logger.error('Error in scheduler:', error);
    return {
      error: 'Internal server error',
      status: 500
    };
  }
}

async function fetchSchedules(searchType) {
  const query = supabase
    .from('saved_search_schedules')
    .select(`
      id,
      is_active,
      last_run_at,
      next_run_at,
      user_id,
      repeat_on,
      saved_searches!inner (
        query,
        query_state,
        search_type
      )
    `)
    .eq('is_active', true)
    .or('next_run_at.lte.now()');

  if (searchType) {
    query.eq('saved_searches.search_type', searchType);
    logger.info(`Filtering for search type: ${searchType}`);
  }

  const { data: schedules, error } = await query;
  
  if (error) throw error;

  logger.info(`Found ${schedules?.length || 0} schedules to process`);
  return schedules || [];
}

async function processSchedules(schedules) {
  for (const schedule of schedules) {
    try {
      logger.info(`Processing schedule ${schedule.id} for search type "${schedule.saved_searches.search_type}"`);
      
      if (schedule.saved_searches.search_type === 'ai') {
        await processAISearch(schedule);
      } else if (schedule.saved_searches.search_type === 'hansard') {
        await processHansardSearch(schedule);
      } else {
        throw new Error(`Unsupported search type: ${schedule.saved_searches.search_type}`);
      }

      // Update schedule timestamps
      await updateScheduleTimestamps(schedule);

    } catch (error) {
      logger.error(`Error processing schedule ${schedule.id}:`, error);
    }
  }
}

async function processAISearch(schedule) {
  // Get current week's assistant ID
  const currentDate = new Date();
  const diff = currentDate.getDate() - currentDate.getDay() + (currentDate.getDay() === 0 ? -6 : 1);
  const monday = new Date(currentDate.setDate(diff));
  const mondayString = monday.toISOString().split('T')[0];

  let assistantId = config.WEEKLY_OPENAI_ASSISTANT_ID;

  const { data: vectorStore, error: vectorStoreError } = await supabase
    .from('vector_stores')
    .select('assistant_id')
    .eq('store_name', `Weekly Debates ${mondayString}`)
    .single();

  if (vectorStoreError) {
    logger.error('Error fetching weekly assistant:', vectorStoreError);
  } else if (vectorStore?.assistant_id) {
    logger.info('Using weekly assistant:', vectorStore.assistant_id);
    assistantId = vectorStore.assistant_id;
  }

  // Create thread and process AI search
  const thread = await openai.beta.threads.create();
  logger.info(`Created thread ${thread.id} for AI search using assistant ${assistantId}`);

  const finalQuery = `${schedule.saved_searches.query}\n\nThe current date is ${new Date().toISOString().split('T')[0]}. Your response must only use the most recent debates, from these days: ${getLastSevenDays().join(', ')}`;

  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: finalQuery
  });

  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistantId
  });

  // Wait for completion
  const response = await waitForAssistantResponse(thread.id, run.id);
  
  // Store the response
  await storeSearchResponse(schedule, response.content, response.citations);
}

async function waitForAssistantResponse(threadId, runId) {
  let runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);
  while (runStatus.status !== 'completed') {
    if (runStatus.status === 'failed' || runStatus.status === 'cancelled') {
      throw new Error(`Run ${runStatus.status}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);
  }

  const messages = await openai.beta.threads.messages.list(threadId);
  const assistantMessage = messages.data.find(msg => msg.role === 'assistant');
  
  if (!assistantMessage?.content[0] || assistantMessage.content[0].type !== 'text') {
    throw new Error('Invalid assistant response');
  }

  const citations = [];
  if ('annotations' in assistantMessage.content[0].text) {
    for (const annotation of assistantMessage.content[0].text.annotations) {
      if ('file_citation' in annotation) {
        const citedFile = await openai.files.retrieve(annotation.file_citation.file_id);
        citations.push(citedFile.filename);
      }
    }
  }

  return {
    content: assistantMessage.content[0].text.value,
    citations
  };
}

async function processHansardSearch(schedule) {
  const searchParams = new URLSearchParams();
  searchParams.set('searchTerm', schedule.saved_searches.query);
  
  // Add house filter if present
  if (schedule.saved_searches.query_state?.house) {
    searchParams.set('house', schedule.saved_searches.query_state.house);
  }
  
  const url = `${HANSARD_API_BASE}/search.json?${searchParams.toString()}`;
  logger.info(`Fetching Hansard data from: ${url}`);

  const hansardResponse = await fetch(url);
  if (!hansardResponse.ok) {
    throw new Error(`Hansard API error: ${hansardResponse.status}`);
  }

  const hansardData = await hansardResponse.json();

  // Format the response and check for changes
  const formattedResponse = await formatHansardResponse(hansardData);
  const hasChanged = await checkForChanges(schedule, formattedResponse);

  // Store the response
  await storeSearchResponse(schedule, JSON.stringify(formattedResponse), formattedResponse.citations || [], hasChanged);
}

async function formatHansardResponse(hansardData) {
  const firstResult = 
    hansardData.Contributions?.[0] || 
    hansardData.WrittenStatements?.[0] || 
    hansardData.WrittenAnswers?.[0] || 
    hansardData.Corrections?.[0] || 
    null;

  return {
    summary: {
      TotalMembers: hansardData.TotalMembers || 0,
      TotalContributions: hansardData.TotalContributions || 0,
      TotalWrittenStatements: hansardData.TotalWrittenStatements || 0,
      TotalWrittenAnswers: hansardData.TotalWrittenAnswers || 0,
      TotalCorrections: hansardData.TotalCorrections || 0,
      TotalPetitions: hansardData.TotalPetitions || 0,
      TotalDebates: hansardData.TotalDebates || 0,
      TotalCommittees: hansardData.TotalCommittees || 0,
      TotalDivisions: hansardData.TotalDivisions || 0
    },
    searchTerms: hansardData.SearchTerms || [],
    firstResult,
    date: new Date().toISOString().split('T')[0],
    citations: firstResult ? [firstResult.ContributionExtId] : []
  };
}

async function checkForChanges(schedule, newResponse) {
  const { data: lastSearch } = await supabase
    .from('saved_searches')
    .select('response')
    .eq('user_id', schedule.user_id)
    .eq('query', schedule.saved_searches.query)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!lastSearch) return true;

  const lastResponse = JSON.parse(lastSearch.response);
  return JSON.stringify(newResponse.firstResult) !== JSON.stringify(lastResponse.firstResult);
}

async function storeSearchResponse(schedule, response, citations, hasChanged = false) {
  const { error: saveError } = await supabase
    .from('saved_searches')
    .insert({
      user_id: schedule.user_id,
      query: schedule.saved_searches.query,
      response,
      citations,
      query_state: schedule.saved_searches.query_state,
      search_type: schedule.saved_searches.search_type,
      has_changed: hasChanged
    });

  if (saveError) throw saveError;
}

async function updateScheduleTimestamps(schedule) {
  const now = new Date();
  const nextRunDate = calculateNextRunDate(schedule.repeat_on);
  
  const { error: updateError } = await supabase
    .from('saved_search_schedules')
    .update({
      last_run_at: now.toISOString(),
      next_run_at: nextRunDate.toISOString()
    })
    .eq('id', schedule.id);

  if (updateError) throw updateError;
}