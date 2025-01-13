import { openai } from '../services/openai.js';
import { getPrompt, debateResponseFormat } from '../prompts/debatePrompts.js';
import { SupabaseService } from '../services/supabase.js';
import { upsertResultsToVectorStore } from './upsertResultstoVectorStore.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).length * 1.3 * 1.2);
}

function trimDebateContext(context, maxTokens = 120000) {
  const estimatedTokens = estimateTokens(context);
  
  if (estimatedTokens <= maxTokens) {
    return context;
  }

  logger.debug('Trimming debate context:', {
    estimatedTokens,
    maxTokens,
    reductionNeeded: estimatedTokens - maxTokens
  });

  // Split into sections (usually divided by speaker)
  const sections = context.split(/(?=\*\*[^*]+\*\*)/);
  
  // Keep introduction and important sections
  const intro = sections[0];
  sections.shift();

  // Calculate estimated tokens for intro
  const introTokens = estimateTokens(intro);
  const remainingTokens = maxTokens - introTokens;
  
  // Prioritize sections with key indicators
  const prioritizedSections = sections.map(section => {
    const priority = calculateSectionPriority(section);
    return { 
      section, 
      priority, 
      tokens: estimateTokens(section)
    };
  }).sort((a, b) => b.priority - a.priority);

  // Build trimmed context
  let trimmedContext = intro;
  let currentTokens = introTokens;

  for (const { section, tokens } of prioritizedSections) {
    if (currentTokens + tokens <= maxTokens) {
      trimmedContext += section;
      currentTokens += tokens;
    } else {
      break;
    }
  }

  logger.debug('Trimmed debate context:', {
    estimatedFinalTokens: estimateTokens(trimmedContext),
    sectionsKept: trimmedContext.split(/(?=\*\*[^*]+\*\*)/).length,
    originalSections: sections.length
  });

  return trimmedContext;
}

function calculateSectionPriority(section) {
  let priority = 0;
  
  // Prioritize ministerial responses
  if (/Minister|Secretary/.test(section)) priority += 5;
  
  // Prioritize sections with data
  if (/[0-9]+%|£[0-9]+|billion|million/.test(section)) priority += 3;
  
  // Prioritize policy discussions
  if (/policy|legislation|amendment|bill/i.test(section)) priority += 2;
  
  // Prioritize questions and responses
  if (/\?/.test(section)) priority += 1;
  
  return priority;
}

export async function batchGenerateAnalysis(debates) {
  let tempInputPath;
  
  try {
    // Extract unique speakers from all debates
    const uniqueSpeakers = new Set();
    debates.forEach(debate => {
      const speakers = debate.context.match(/\*\*([^*]+)\*\*/g) || [];
      speakers.forEach(speaker => uniqueSpeakers.add(speaker.replace(/\*/g, '')));
    });

    // Create batch input file
    tempInputPath = path.join(os.tmpdir(), `debate-batch-${Date.now()}.jsonl`);
    const batchRequests = debates.map(debate => {
      // Trim context if needed
      const trimmedContext = trimDebateContext(debate.context);
      const contextWords = trimmedContext.split(/\s+/).length;
      const speakerCount = uniqueSpeakers.size;
      
      // Calculate max tokens needed
      const maxTokens = Math.min(4096, Math.floor(
        (contextWords * 1.5) + (speakerCount * 200)
      ));

      return {
        custom_id: debate.ext_id,
        method: 'POST',
        url: '/v1/chat/completions',
        body: {
          model: 'gpt-4o',
          messages: [{
            role: 'user',
            content: getPrompt({ ...debate, context: trimmedContext }, Array.from(uniqueSpeakers))
          }],
          max_tokens: maxTokens,
          response_format: debateResponseFormat()
        }
      };
    });

    // Write batch requests to temp file
    fs.writeFileSync(
      tempInputPath, 
      batchRequests.map(req => JSON.stringify(req)).join('\n')
    );

    logger.debug('Created batch file:', {
      path: tempInputPath,
      requestCount: batchRequests.length,
      fileSize: fs.statSync(tempInputPath).size
    });

    // Submit batch
    const batch = await openai.files.create({
      file: fs.createReadStream(tempInputPath),
      purpose: 'batch'
    });

    logger.debug('Submitted batch:', { 
      id: batch.id,
      status: batch.status,
      created: new Date(batch.created_at * 1000).toISOString()
    });

    // Poll for batch completion with logging
    let completedBatch;
    let pollCount = 0;
    const startTime = Date.now();
    const pollInterval = 30000; // 30 seconds

    do {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      completedBatch = await openai.files.retrieve(batch.id);
      pollCount++;

      const elapsedMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      
      logger.debug('Batch status update:', {
        batchId: batch.id,
        status: completedBatch.status,
        pollCount,
        elapsedMinutes: `${elapsedMinutes}m`,
        estimatedTimePerDebate: `${(elapsedMinutes / debates.length).toFixed(1)}m`,
        debateCount: debates.length
      });

      // Log warning if taking too long
      if (pollCount % 12 === 0) { // Every minute
        logger.warn('Batch processing time:', {
          batchId: batch.id,
          status: completedBatch.status,
          elapsedMinutes: `${elapsedMinutes}m`,
          debateCount: debates.length
        });
      }

    } while (completedBatch.status !== 'completed' && completedBatch.status !== 'failed');

    // Handle failed batch
    if (completedBatch.status === 'failed') {
      logger.error('Batch processing failed:', {
        batchId: batch.id,
        elapsedTime: `${((Date.now() - startTime) / 1000 / 60).toFixed(1)}m`,
        pollCount,
        error: completedBatch.error || 'Unknown error'
      });
      throw new Error(`Batch processing failed: ${completedBatch.error || 'Unknown error'}`);
    }

    // Get results
    const fileResponse = await openai.files.content(completedBatch.output_file_id);
    const resultContent = await fileResponse.text();
    
    logger.debug('Batch completed successfully:', {
      batchId: batch.id,
      outputFileId: completedBatch.output_file_id,
      resultCount: resultContent.split('\n').filter(Boolean).length,
      totalTime: `${((Date.now() - startTime) / 1000 / 60).toFixed(1)}m`,
      averageTimePerDebate: `${((Date.now() - startTime) / 1000 / 60 / debates.length).toFixed(1)}m`
    });

    // Process results
    const processedResults = resultContent
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          logger.error('Failed to parse result:', {
            error: error.message,
            line: line.slice(0, 100) + '...'
          });
          return null;
        }
      })
      .filter(Boolean);

    // Update vector store and Supabase
    const fileResults = await upsertResultsToVectorStore(debates, processedResults, Array.from(uniqueSpeakers));
    
    // Prepare Supabase updates
    const debateUpdates = fileResults.map(({ ext_id, fileId }) => {
      const debate = debates.find(d => d.ext_id === ext_id);
      const result = processedResults.find(r => r.custom_id === ext_id);
      
      if (!debate || !result) return null;

      const parsedContent = JSON.parse(result.response.body.choices[0].message.content);
      
      return {
        ext_id,
        title: debate.overview.Title,
        type: debate.overview.Type,
        house: debate.overview.House,
        date: debate.overview.Date.split('T')[0],
        analysis: parsedContent.analysis,
        speaker_points: parsedContent.speaker_points,
        file_id: fileId,
        updated_at: new Date().toISOString()
      };
    }).filter(Boolean);

    console.log('Debate updates:', debateUpdates.length);

    // Batch update Supabase
    if (debateUpdates.length > 0) {
      await SupabaseService.batchUpsertDebates(debateUpdates);
    }

    return processedResults;

  } catch (error) {
    logger.error('Batch processing failed:', error);
    throw error;
  } finally {
    if (tempInputPath && fs.existsSync(tempInputPath)) {
      fs.unlinkSync(tempInputPath);
    }
  }
}