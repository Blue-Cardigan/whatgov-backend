import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SupabaseService } from '../services/supabase.js';
import { assistantPrompt } from '../utils/assistantPrompt.js';

const PERMANENT_STORE_ID = 'vs_3R5Unz1iS6bKaUcet2DQcRmF';
const POLL_INTERVAL = 1000; // 1 second
const MAX_POLL_ATTEMPTS = 60; // 1 minute maximum wait

async function pollFileBatch(vectorStoreId, batchId) {
  let attempts = 0;
  
  while (attempts < MAX_POLL_ATTEMPTS) {
    const batch = await openai.beta.vectorStores.fileBatches.retrieve(
      vectorStoreId,
      batchId
    );

    console.log('Polling vector store file batch:', {
      batchId,
      status: batch.status,
      fileCounts: batch.file_counts
    });

    if (batch.status === 'completed') {
      return batch;
    }

    if (batch.status === 'failed' || batch.status === 'cancelled') {
      throw new Error(`Batch ${batchId} ${batch.status}`);
    }

    if (batch.file_counts.failed > 0) {
      throw new Error(`${batch.file_counts.failed} files failed processing in batch ${batchId}`);
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    attempts++;
  }

  throw new Error(`Timeout waiting for batch ${batchId} to complete`);
}

async function createAssistantWithVectorStore(storeId, storeName) {
  try {
    logger.debug('Creating new assistant with vector store:', {
      storeId,
      storeName
    });

    const assistant = await openai.beta.assistants.create({
      name: `Parliamentary Debates Assistant - ${storeName}`,
      instructions: assistantPrompt,
      model: "gpt-4o",
      tools: [{ type: "file_search" }],
    });

    console.log('Assistant created:', assistant.id, assistant.name);

    // Update assistant with vector store
    await openai.beta.assistants.update(assistant.id, {
      tool_resources: { 
        file_search: { 
          vector_store_ids: [storeId] 
        } 
      },
    });

    logger.info('Successfully created assistant with vector store:', {
      assistantId: assistant.id,
      storeId,
      storeName
    });

    return assistant.id;
  } catch (error) {
    logger.error('Failed to create assistant:', {
      error: error.message,
      stack: error.stack,
      storeId,
      storeName
    });
    throw error;
  }
}

async function getOrCreateWeeklyStore(debateDate) {
  try {
    // Calculate the first day of the week (Monday) for the given date
    const startOfWeek = new Date(debateDate);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1); // Monday is 1

    // Calculate end of week (Sunday)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    logger.debug('Calculating store dates:', {
      debateDate,
      weekStart: startOfWeek.toISOString(),
      weekEnd: endOfWeek.toISOString()
    });

    const currentStore = await SupabaseService.getCurrentVectorStore(startOfWeek.toISOString());
    
    if (currentStore && 
        new Date(debateDate) >= new Date(currentStore.start_date) &&
        new Date(debateDate) <= new Date(currentStore.end_date)) {
      logger.debug('Using existing store:', {
        store_id: currentStore.store_id,
        assistant_id: currentStore.assistant_id,
        start_date: currentStore.start_date,
        end_date: currentStore.end_date
      });
      return currentStore.store_id;
    }

    // Create new weekly store
    const storeName = `Weekly Debates ${startOfWeek.toISOString().split('T')[0]}`;
    
    // Create the vector store in OpenAI
    const vectorStore = await openai.beta.vectorStores.create({
      name: storeName,
      description: `Weekly debate store for week starting ${startOfWeek.toISOString().split('T')[0]}`,
      metadata: {
        start_date: startOfWeek.toISOString(),
        end_date: endOfWeek.toISOString(),
        type: 'weekly_debates'
      }
    });

    // Create assistant with this vector store
    const assistantId = await createAssistantWithVectorStore(vectorStore.id, storeName);
    
    // Record both store and assistant in Supabase
    await SupabaseService.createWeeklyVectorStore(
      vectorStore.id,
      startOfWeek,
      endOfWeek,
      assistantId
    );

    logger.info('Successfully created new weekly store and assistant:', {
      store_id: vectorStore.id,
      assistant_id: assistantId,
      name: storeName,
      start_date: startOfWeek.toISOString(),
      end_date: endOfWeek.toISOString()
    });

    return vectorStore.id;

  } catch (error) {
    logger.error('Failed to create/get weekly vector store:', {
      error: error.message,
      stack: error.stack,
      debateDate
    });
    throw error;
  }
}

export async function prepareDebateFile(debateData, analysis, uniqueSpeakers) {
  // Extract metadata
  const overview = debateData.overview || debateData.debate?.overview || {};

  // Format content as structured text
  const metadataText = [
    '=== METADATA ===',
    `Title: ${overview.Title || 'N/A'}`,
    `Type: ${overview.Type || 'N/A'}`,
    `House: House of ${overview.House || 'N/A'}`,
    `Date: ${overview.Date ? overview.Date.split('T')[0] : 'N/A'}`,
    `Day: ${overview.Date ? new Date(overview.Date).toLocaleString('en-GB', { weekday: 'long' }) : 'N/A'}`,
    `${overview.StartTime ? `Time: ${overview.StartTime}` : ''}`,
    '',
    '=== SPEAKERS ===',
    ...(uniqueSpeakers || []).map(speaker => 
      [
        `Name: ${speaker.name || 'N/A'}`,
        speaker.party ? `Party: ${speaker.party}` : '',
        speaker.constituency ? `Constituency: ${speaker.constituency}` : '',
        speaker.role ? `Role: ${speaker.role}` : '',
        ''
      ].filter(line => line).join('\n')
    ),
    ''
  ].join('\n');

  const analysisText = analysis.analysis?.main_content 
    ? ['=== ANALYSIS ===', analysis.analysis.main_content, ''].join('\n')
    : '';

  const contributionsText = analysis.speaker_points?.length
    ? [
        '=== CONTRIBUTIONS ===',
        ...analysis.speaker_points.map(speakerPoint => 
          [
            `SPEAKER: ${speakerPoint.name} (${speakerPoint.party})`,
            ...speakerPoint.contributions.map(contribution => 
              [
                'CONTRIBUTION:',
                contribution.content || contribution.point,
                contribution.references?.length ? `References: ${contribution.references.map(ref => ref.value).join(', ')}` : '',
                ''
              ].join('\n')
            )
          ].join('\n')
        ),
        ''
      ].join('\n')
    : '';

  const finalContent = [metadataText, analysisText, contributionsText].join('\n');

  return {
    content: finalContent,
    debateId: overview.ExternalId || debateData.ext_id || Date.now().toString()
  };
}

export async function upsertResultsToVectorStore(debates, analysisResults, uniqueSpeakers) {
  const debatesArray = Array.isArray(debates) ? debates : [debates];
  const tempFiles = [];
  const tempDir = path.join(os.tmpdir(), `debate-batch-${Date.now()}`);
  
  try {
    // Ensure debates is an array
    const debatesArray = Array.isArray(debates) ? debates : [debates];
    
    logger.debug('Processing vector store:', {
      debateCount: debatesArray.length,
      hasAnalysisResults: Boolean(analysisResults),
      speakerCount: uniqueSpeakers?.length || 0
    });

    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true });

    logger.debug('Created temp directory:', { tempDir });

    // Prepare all files in parallel
    const preparedFiles = await Promise.all(
      debatesArray.map(async (debate, index) => {
        // Get corresponding analysis result
        const analysis = Array.isArray(analysisResults) 
          ? analysisResults[index]
          : analysisResults;

        if (!analysis) {
          logger.warn('No analysis found for debate:', {
            ext_id: debate.ext_id,
            title: debate.overview?.Title
          });
          return null;
        }

        // Log the analysis structure for debugging
        logger.debug('Processing analysis:', {
          debateId: debate.ext_id,
          analysisType: typeof analysis,
          hasAnalysis: Boolean(analysis.analysis),
          hasSpeakerPoints: Boolean(analysis.speaker_points)
        });

        try {
          // Analysis is already parsed JSON from generateAnalysis
          return {
            content: await prepareDebateFile(debate, analysis, uniqueSpeakers),
            ext_id: debate.ext_id,
            title: debate.overview?.Title
          };
        } catch (error) {
          logger.error('Failed to prepare debate file:', {
            ext_id: debate.ext_id,
            error: error.message,
            analysisStructure: JSON.stringify(analysis, null, 2)
          });
          return null;
        }
      })
    );

    // Filter out nulls and continue with file processing
    const validFiles = preparedFiles.filter(Boolean);
    
    if (validFiles.length === 0) {
      throw new Error('No valid files were prepared from the analysis results');
    }

    logger.debug('Prepared files for vector store:', {
      totalFiles: validFiles.length,
      tempDir
    });

    // Create temporary files and collect file streams
    const fileStreams = validFiles.map(({ content, ext_id }) => {
      const filePath = path.join(tempDir, `debate-${ext_id}.txt`);
      fs.writeFileSync(filePath, content.content);
      tempFiles.push(filePath);
      return fs.createReadStream(filePath);
    });

    // Upload files to OpenAI and get file IDs
    const uploadedFiles = await Promise.all(
      fileStreams.map(stream => 
        openai.files.create({
          file: stream,
          purpose: 'assistants'
        })
      )
    );

    // Prepare debate records for Supabase
    const debateRecords = validFiles.map((file, index) => {
      const debate = debatesArray[index];
      const analysis = Array.isArray(analysisResults) ? analysisResults[index] : analysisResults;
      const fileId = uploadedFiles[index].id;

      return {
        ext_id: debate.ext_id,
        title: debate.overview?.Title,
        type: debate.overview?.Type,
        date: debate.overview?.Date,
        house: debate.overview?.House,
        analysis: analysis.analysis,
        speaker_points: analysis.speaker_points,
        file_id: fileId,
        updated_at: new Date().toISOString()
      };
    });

    // Batch upsert to Supabase
    logger.info('Upserting debates to Supabase:', {
      count: debateRecords.length,
      ids: debateRecords.map(d => d.ext_id)
    });

    await SupabaseService.batchUpsertDebates(debateRecords);

    // Get the appropriate weekly store ID
    const weeklyStoreId = await getOrCreateWeeklyStore(debateRecords[0].date);
    console.log('Weekly store ID:', weeklyStoreId);

    // Upload to both stores
    const stores = [PERMANENT_STORE_ID, weeklyStoreId];
    await Promise.all(stores.map(async (storeId) => {
      const batch = await openai.beta.vectorStores.fileBatches.create(
        storeId,
        { file_ids: uploadedFiles.map(f => f.id) }
      );

      logger.debug('Created vector store batch:', {
        storeId,
        batchId: batch.id,
        fileCount: uploadedFiles.length
      });

      await pollFileBatch(storeId, batch.id);
    }));

    // Return the results with file IDs
    return debateRecords.map(record => ({
      ext_id: record.ext_id,
      file_id: record.file_id,
      title: record.title
    }));

  } catch (error) {
    logger.error('Failed to upsert results:', {
      error: error.message,
      stack: error.stack,
      debateCount: debatesArray.length
    });
    throw error;
  } finally {
    // Clean up temporary files
    tempFiles.forEach(filePath => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        logger.warn('Failed to clean up temporary file:', {
          error: error.message,
          filePath
        });
      }
    });

    try {
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    } catch (error) {
      logger.warn('Failed to clean up temporary directory:', {
        error: error.message,
        tempDir
      });
    }
  }
}