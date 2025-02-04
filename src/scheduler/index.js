import { config } from '../config/config.js';
import { supabase } from '../services/supabase.js';
import { processCalendarItems } from './calendar.js';
import { calculateNextRunDate } from './schedulerUtils.js';
import { getLastSevenDays } from '../utils/debateUtils.js';
import { processDailySummary } from './dailySummary.js';
import logger from '../utils/logger.js';

const openai = config.OPENAI;

export async function processScheduledSearches(searchType) {
  try {
    logger.info('Starting scheduled search processing');

    // Process weekly summary if needed
    if (searchType === null || searchType === 'frontpage') {
      await processDailySummary();
    }

    // Process calendar items if needed
    if (searchType === 'calendar') {
      return await processCalendarItems();
    }

    // Process regular searches
    const schedules = await fetchSchedules(searchType);
    await processSchedules(schedules);
    await processMPSearch();

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
        response,
        citations,
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
      
      switch (schedule.saved_searches.search_type) {
        case 'ai':
          await processAISearch(schedule);
          break;
        case 'hansard':
          await processHansardSearch(schedule);
          break;
        default:
          throw new Error(`Unsupported search type: ${schedule.saved_searches.search_type}`);
      }

      // Update schedule timestamps
      await updateScheduleTimestamps(schedule);

    } catch (error) {
      logger.error(`Error processing schedule ${schedule.id}:`, error);
    }
  }
}

async function processMPSearch() {
    try {
      logger.info('Processing MP searches');
  
      // First get all unique MP IDs being tracked
      const { data: searches, error } = await supabase
        .from('saved_searches')
        .select('query_state->mp')
        .eq('search_type', 'mp');
  
      if (error) throw error;
      if (!searches?.length) {
        logger.info('No MP searches found to process');
        return;
      }
  
      // Get unique MP IDs
      const uniqueMpIds = [...new Set(searches.map(s => s.mp).filter(Boolean))];
      logger.info(`Found ${uniqueMpIds.length} unique MPs to check`);
  
      // Process each MP once
      for (const mpId of uniqueMpIds) {
        try {
          logger.info(`Processing MP ${mpId}`);
  
          // Get latest debate for this MP
          const { data: latestDebates, error: debateError } = await supabase.rpc('search_member_debates', {
            p_member_id: mpId.toString(),
            p_limit: 1,
            p_offset: 0
          });
  
          if (debateError) throw debateError;
          if (!latestDebates?.length) {
            logger.info(`No debates found for MP ${mpId}`);
            continue;
          }
  
          const latestDebate = latestDebates[0];
          const formattedResponse = {
            firstDebate: {
              debate_id: latestDebate.debate_id,
              debate_title: latestDebate.debate_title,
              debate_type: latestDebate.debate_type,
              debate_house: latestDebate.debate_house,
              debate_date: latestDebate.debate_date,
              member_name: latestDebate.member_name,
              member_party: latestDebate.member_party,
              member_constituency: latestDebate.member_constituency,
              member_role: latestDebate.member_role,
              member_contributions: latestDebate.member_contributions
            }
          };
          // Get all users tracking this MP and their latest responses
          const { data: userSearches, error: userError } = await supabase
            .from('saved_searches')
            .select('user_id, response')
            .eq('search_type', 'mp')
            .eq('query_state->mp', `"${mpId.toString()}"`)
            .order('created_at', { ascending: false });
  
          if (userError) throw userError;
  
          // Group by user and get only their latest search
          const userLatestSearches = userSearches.reduce((acc, search) => {
            if (!acc[search.user_id]) {
              acc[search.user_id] = search;
            }
            return acc;
          }, {});
  
          // Check for changes and create notifications for each user
          for (const [userId, userSearch] of Object.entries(userLatestSearches)) {
            try {
              const lastResponse = JSON.parse(userSearch.response);
              const hasChanged = lastResponse.firstDebate.debate_id !== formattedResponse.firstDebate.debate_id;
              if (hasChanged) {
                logger.info(`Changes detected for MP ${mpId}, storing new response for user ${userId}`);
                await storeSearchResponse({
                  saved_searches: {
                    query: latestDebate.member_name,
                    query_state: { mp: mpId },
                    search_type: 'mp'
                  },
                  user_id: userId
                }, JSON.stringify(formattedResponse), [latestDebate.debate_id], true);
              } else {
                logger.info(`No changes detected for MP ${mpId} for user ${userId}`);
              }
            } catch (error) {
              logger.error(`Error processing user ${userId} for MP ${mpId}:`, error);
              continue;
            }
          }
  
        } catch (error) {
          logger.error(`Error processing MP ${mpId}:`, error);
          continue;
        }
      }
  
    } catch (error) {
      logger.error('Error in processMPSearch:', error);
      throw error;
    }
  }

async function processAISearch(schedule) {

  let assistantId = config.WEEKLY_ASSISTANT_ID;

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
    const { query, query_state } = schedule.saved_searches;
    
    logger.info(`Performing search_debates RPC for query: ${query}`);
  
    // Call search_debates RPC
    const { data: debates, error } = await supabase.rpc('search_debates', {
      search_term: query,
      house_filter: query_state?.house?.toLowerCase() || null,
      member_filter: query_state?.member || null,
      party_filter: query_state?.party || null,
      date_from: query_state?.date_from || null,
      date_to: query_state?.date_to || null
    });
  
    if (error) throw new Error(`search_debates error: ${error.message}`);
  
    // Format the response and check for changes
    const formattedResponse = formatDebatesResponse(debates);
    const hasChanged = await checkForChanges(schedule, formattedResponse);
  
    // Store the response
    await storeSearchResponse(
      schedule, 
      JSON.stringify(formattedResponse.debateIds),
      formattedResponse.citations,
      hasChanged
    );
  }
  
  function formatDebatesResponse(debates) {
    // Extract debate IDs in chronological order
    const debateIds = debates.map(d => d.ext_id);
  
    return {
      debateIds,
      citations: debateIds.slice(0, 1), // Use first debate ID as citation
      date: new Date().toISOString().split('T')[0]
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
  
    // Compare debate IDs array
    const lastDebateIds = JSON.parse(lastSearch.response);
    return JSON.stringify(newResponse.debateIds) !== JSON.stringify(lastDebateIds);
  }
  
  async function storeSearchResponse(schedule, response, citations, hasChanged = false) {
    const { error: saveError } = await supabase
      .from('saved_searches')
      .insert({
        user_id: schedule.user_id,
        query: schedule.saved_searches.query,
        response, // Array of debate IDs as JSON string
        citations, // Array of debate IDs (usually just the first one)
        query_state: schedule.saved_searches.query_state,
        search_type: schedule.saved_searches.search_type,
        has_changed: hasChanged,
        is_unread: true
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