import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { getLastSevenDays } from '../utils/debateUtils.js';
import { getPrompt, debateResponseFormat } from './debatePrompts.js';
import { getWeeklySummaryPrompt, weeklySummaryFormat } from './weeklyPrompts.js';
import logger from '../utils/logger.js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SERVICE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const defaultAssistantID = process.env.DEFAULT_OPENAI_ASSISTANT_ID;

const HANSARD_API_BASE = 'https://hansard-api.parliament.uk';

export async function processScheduledSearches(searchType) {
    try {
      logger.info('Starting scheduled search processing');

    // Before processing AI searches, generate weekly summary
    if (!searchType || searchType === 'frontpage') {
      console.log('[Scheduler] Generating weekly summary...');
      
      // Get current week's Monday
      const currentDate = new Date();
      const diff = currentDate.getDate() - currentDate.getDay() + (currentDate.getDay() === 0 ? -6 : 1);
      const monday = new Date(currentDate.setDate(diff));
      const mondayString = monday.toISOString().split('T')[0];

      // Get the weekly assistant ID
      let assistantId = defaultAssistantID;
      
      const { data: vectorStore, error: vectorStoreError } = await supabase
        .from('vector_stores')
        .select('assistant_id')
        .eq('store_name', `Weekly Debates ${mondayString}`)
        .single();

      if (vectorStoreError) {
        console.error('[Scheduler] Error fetching weekly assistant:', vectorStoreError);
      } else if (vectorStore?.assistant_id) {
        console.log('[Scheduler] Using weekly assistant:', vectorStore.assistant_id);
        assistantId = vectorStore.assistant_id;
      }

      try {
        // Create a thread
        const thread = await openai.beta.threads.create();
        console.log(`[Scheduler] Created thread ${thread.id} for weekly summary using assistant ${assistantId}`);

        // Add the message to the thread
        await openai.beta.threads.messages.create(thread.id, {
          role: "user",
          content: getWeeklySummaryPrompt()
        });

        // Run the assistant
        const run = await openai.beta.threads.runs.create(thread.id, {
          assistant_id: assistantId,
          instructions: "Generate a weekly summary following the format exactly. Ensure all citations are included.",
          response_format: weeklySummaryFormat
        });

        // Wait for completion using same approach as AI searches
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

        // Store the weekly summary
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
          console.error('[Scheduler] Error storing weekly summary:', summaryError);
        } else {
          console.log('[Scheduler] Successfully generated and stored weekly summary');
        }
      } catch (error) {
        console.error('[Scheduler] Error generating weekly summary:', error);
      }
    }

    // If it's a calendar search, process calendar items directly
    if (searchType === 'calendar') {
      // Get all calendar items that haven't been processed yet
      const today = new Date().toISOString().split('T')[0];
      const { data: calendarItems, error: calendarError } = await supabase
        .from('saved_calendar_items')
        .select('*')
        .is('debate_ids', null)  // Only get items that haven't been processed
        .lt('date', today)       // Only get items before today
        .order('date', { ascending: true });

      if (calendarError) {
        console.error('[Scheduler] Error fetching calendar items:', calendarError);
        throw calendarError;
      }

      console.log(`[Scheduler] Found ${calendarItems?.length || 0} unprocessed calendar items`);

      // Process each calendar item individually
      for (const item of calendarItems || []) {
        try {
          const eventData = item.event_data;
          if (eventData.type === 'event') {
            // Search for this debate in Hansard
            const searchParams = new URLSearchParams({
              'queryParameters.searchTerm': eventData.event.title.replace('[HL]', '').trim(),
              'queryParameters.date': item.date,
              'queryParameters.house': eventData.event.house,
              'queryParameters.startDate': eventData.event.startTime.split('T')[0],
              'queryParameters.endDate': eventData.event.endTime.split('T')[0]
            });

            const url = `${HANSARD_API_BASE}/search/debates.json?${searchParams.toString()}`;
            console.log(`[Scheduler] Searching for debate:`, url);
            
            const debateResponse = await fetch(url);
            
            if (!debateResponse.ok) {
              console.error(`[Scheduler] Error fetching debate:`, await debateResponse.text());
              continue;
            }

            const debateData = await debateResponse.json();
            const debateResults = debateData.Results || [];

            if (debateResults.length > 0) {
              // Update the calendar item with debate IDs and AI response
              const { error: updateError } = await supabase
                .from('saved_calendar_items')
                .update({
                  debate_ids: debateResults.map((d) => d.DebateSectionExtId),
                  is_unread: true
                })
                .eq('id', item.id);

              if (updateError) {
                console.error(`[Scheduler] Error updating calendar item:`, updateError);
                throw updateError;
              }

              console.log(`[Scheduler] Successfully processed calendar item ${item.id} with ${debateResults.length} debates`);
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
                console.error(`[Scheduler] Error updating calendar item:`, updateError);
                throw updateError;
              }
            }
          } else if (eventData.type === 'oral-questions') {
            // Check if this is a whole session or individual question
            const isWholeSession = !item.event_id.includes('-q');
            let allDebateIds = [];
            const questionResponses = {};

            // Process each oral question
            for (const question of eventData.questions) {
              const searchParams = new URLSearchParams({
                'queryParameters.searchTerm': question.text,
                'queryParameters.startDate': item.date,
                'queryParameters.endDate': item.date
              });

              const url = `${HANSARD_API_BASE}/search.json?${searchParams.toString()}`;
              console.log(`[Scheduler] Searching for oral question:`, url);
              
              const questionResponse = await fetch(url);
              
              if (!questionResponse.ok) {
                console.error(`[Scheduler] Error fetching oral question:`, await questionResponse.text());
                continue;
              }

              const questionData = await questionResponse.json();
              const debateIds = questionData.Contributions?.map((c) => c.DebateSectionExtId) || [];
              allDebateIds.push(...debateIds);

              // If we found any debates and this is a whole session, fetch the top-level debate
              if (isWholeSession && debateIds.length > 0) {
                try {
                  const topLevelUrl = `${HANSARD_API_BASE}/debates/topleveldebateid/${debateIds[0]}.json`;
                  const topLevelResponse = await fetch(topLevelUrl);

                  if (topLevelResponse.ok) {
                    const topLevelId = await topLevelResponse.text();
                    if (topLevelId) {
                      const cleanTopLevelId = topLevelId.replace(/['"]/g, '');
                      allDebateIds = [cleanTopLevelId];
                      console.log('Top level debate ID', cleanTopLevelId);

                      // Generate AI analysis for oral questions
                      if (isWholeSession && allDebateIds.length > 0) {
                        try {
                          // Fetch the full debate content
                          const debateUrl = `${HANSARD_API_BASE}/debates/debate/${cleanTopLevelId}.json`;
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

                          // Use our standardized debate prompt with the actual debate content
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
                                ext_id: cleanTopLevelId,
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
                              console.error(`[Scheduler] Error inserting debate:`, debateError);
                            }
                          }
                        } catch (error) {
                          console.error(`[Scheduler] Error processing debate content:`, error);
                          if (error instanceof Error) {
                            console.error(`[Scheduler] Error details: ${error.message}`);
                          }
                        }
                      }
                      break; // We only need one top-level ID for the whole session
                    }
                  }
                } catch (error) {
                  console.error(`[Scheduler] Error fetching top-level debate:`, error);
                }
              }

              // For individual questions, store the response
              if (!isWholeSession && debateIds.length > 0) {
                questionResponses[question.id] = `Question: ${question.text}\nAsking Member: ${question.askingMembers}`;
              }
            }

            // Update the calendar item (now without the response)
            const { error: updateError } = await supabase
              .from('saved_calendar_items')
              .update({
                debate_ids: allDebateIds,
              })
              .eq('id', item.id);

            if (updateError) {
              console.error(`[Scheduler] Error updating calendar item:`, updateError);
              throw updateError;
            }

            console.log(`[Scheduler] Successfully processed ${isWholeSession ? 'session' : 'question'} with ${allDebateIds.length} debates`);
          }
        } catch (error) {
          console.error(`[Scheduler] Error processing calendar item ${item.id}:`, error);
          // Continue with next item even if one fails
        }
      }

      // For the saved_searches record, summarize all calendar processing
      await supabase
        .from('saved_calendar_items')
        .select('debate_ids, response')
        .not('debate_ids', 'is', null)
        .order('date', { ascending: false })
        .limit(1);

      return new Response(JSON.stringify({ 
        success: true,
        processed: calendarItems?.length || 0 
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // For non-calendar searches, continue with existing schedule processing...
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0];
    
    console.log('[Scheduler] Starting query with service role...');
    
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

    // Add search type filter if specified
    if (searchType) {
      query.eq('saved_searches.search_type', searchType);
      console.log(`[Scheduler] Filtering for search type: ${searchType}`);
    }

    const { data: schedules, error: schedulesError } = await query;

    console.log(`[Scheduler] Query conditions:`, {
      is_active: true,
      or: [
        'last_run_at IS NULL',
        `next_run_at <= ${now.toISOString()}`
      ]
    });

    if (schedulesError) {
      console.error('[Scheduler] Error fetching schedules:', schedulesError);
      throw schedulesError;
    }

    console.log(`[Scheduler] Query results:`, {
      count: schedules?.length || 0,
      schedules: schedules?.map(s => ({
        id: s.id,
        next_run_at: s.next_run_at,
        query: s.saved_searches.query
      }))
    });

    // 2. Process each schedule
    for (const schedule of schedules || []) {
      try {
        console.log(`[Scheduler] Processing schedule ${schedule.id} for search type "${schedule.saved_searches.search_type}"`);

        let response;
        let citations = [];
        let hasChanged = false;
        let finalQuery = schedule.saved_searches.query;

        if (schedule.saved_searches.search_type === 'ai') {
          // Get current week's assistant ID
          const currentDate = new Date();
          const diff = currentDate.getDate() - currentDate.getDay() + (currentDate.getDay() === 0 ? -6 : 1);
          const monday = new Date(currentDate.setDate(diff));
          const mondayString = monday.toISOString().split('T')[0];

          let assistantId = defaultAssistantID; // Default fallback

          const { data: vectorStore, error: vectorStoreError } = await supabase
            .from('vector_stores')
            .select('assistant_id')
            .eq('store_name', `Weekly Debates ${mondayString}`)
            .single();

          if (vectorStoreError) {
            console.error('[Scheduler] Error fetching weekly assistant:', vectorStoreError);
          } else if (vectorStore?.assistant_id) {
            console.log('[Scheduler] Using weekly assistant:', vectorStore.assistant_id);
            assistantId = vectorStore.assistant_id;
          }

          // Process AI search with selected assistant
          const thread = await openai.beta.threads.create();
          console.log(`[Scheduler] Created thread ${thread.id} for AI search using assistant ${assistantId}`);

          finalQuery += `\n\nThe current date is ${new Date().toISOString().split('T')[0]}. Your response must only use the most recent debates, from these days: ${getLastSevenDays().join(', ')}`
          
          await openai.beta.threads.messages.create(thread.id, {
            role: "user",
            content: finalQuery
          });

          const run = await openai.beta.threads.runs.create(thread.id, {
            assistant_id: assistantId
          });

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

          response = assistantMessage.content[0].text.value;

          // Extract citations if any
          if ('annotations' in assistantMessage.content[0].text) {
            for (const annotation of assistantMessage.content[0].text.annotations) {
              if ('file_citation' in annotation) {
                const citedFile = await openai.files.retrieve(annotation.file_citation.file_id);
                citations.push(citedFile.filename);
              }
            }
          }

          hasChanged = false;
        } else if (schedule.saved_searches.search_type === 'hansard') {
          console.log(`[Scheduler] Processing Hansard search with query:`, schedule.saved_searches.query);
          
          // For Hansard searches, use the stored query directly as it may contain advanced search directives
          const searchParams = new URLSearchParams();
          searchParams.set('searchTerm', schedule.saved_searches.query);
          
          // Add house filter if present
          if (schedule.saved_searches.query_state?.house) {
            searchParams.set('house', schedule.saved_searches.query_state.house);
          }
          
          const url = `${HANSARD_API_BASE}/search.json?${searchParams.toString()}`;
          console.log(`[Scheduler] Fetching Hansard data from: ${url}`);

          const hansardResponse = await fetch(url);
          if (!hansardResponse.ok) {
            throw new Error(`Hansard API error: ${hansardResponse.status}`);
          }

          const hansardData = await hansardResponse.json();

          // Get the first result from any available result type, prioritizing Contributions
          const firstResult = 
            hansardData.Contributions?.[0] || 
            hansardData.WrittenStatements?.[0] || 
            hansardData.WrittenAnswers?.[0] || 
            hansardData.Corrections?.[0] || 
            null;

          // Format the response to match SaveSearchButton format
          const formattedResponse = {
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
            date: todayDate
          };

          // Get the last stored result for comparison
          const { data: lastSearch, error: lastSearchError } = await supabase
            .from('saved_searches')
            .select('response')
            .eq('user_id', schedule.user_id)
            .eq('query', schedule.saved_searches.query)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (lastSearchError) {
            console.error('[Scheduler] Error fetching last search:', lastSearchError);
          }

          // Parse the last search response and compare first results
          const lastFirstResult = lastSearch ? JSON.parse(lastSearch.response).firstResult : null;
          hasChanged = JSON.stringify(firstResult) !== JSON.stringify(lastFirstResult);

          response = JSON.stringify(formattedResponse);
          citations = firstResult ? [firstResult.ContributionExtId] : [];
        } else {
          throw new Error(`Unsupported search type: ${schedule.saved_searches.search_type}`);
        }

        // Store the response
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

        if (saveError) {
          console.error(`[Scheduler] Error saving search:`, saveError);
          throw saveError;
        }

        // Update schedule timestamps
        const nextRunDate = calculateNextRunDate(schedule.repeat_on);
        const { error: updateError } = await supabase
          .from('saved_search_schedules')
          .update({
            last_run_at: now.toISOString(),
            next_run_at: nextRunDate.toISOString()
          })
          .eq('id', schedule.id);

        if (updateError) throw updateError;

      } catch (error) {
        console.error(`[Scheduler] Error processing schedule ${schedule.id}:`, error);
        // Continue with next schedule even if one fails
      }
    }

    console.log('[Scheduler] Completed processing all schedules');
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Scheduler] Error in scheduler:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }), 
      { status: 500 }
    );
  }
}

function calculateNextRunDate(repeatOn) {
  const now = new Date();
  const nextDate = new Date(now);
  
  if (repeatOn.frequency === 'weekly') {
    // Convert from ISO day (1-7, Monday-Sunday) to JS day (0-6, Sunday-Saturday)
    const targetDay = repeatOn.dayOfWeek === 7 ? 0 : repeatOn.dayOfWeek;
    const currentDay = nextDate.getDay();
    
    // Calculate days until next occurrence
    let daysToAdd = (targetDay - currentDay + 7) % 7;
    if (daysToAdd === 0) {
      // If it's the same day but past 7am, schedule for next week
      if (nextDate.getHours() >= 7) {
        daysToAdd = 7;
      }
    }
    
    // Add the calculated days
    nextDate.setDate(nextDate.getDate() + daysToAdd);
    // Set to 7am
    nextDate.setHours(7, 0, 0, 0);
  }
  
  return nextDate;
}