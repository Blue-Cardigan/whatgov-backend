import { openai } from '../services/openai.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const VECTOR_STORE_ID = 'vs_3R5Unz1iS6bKaUcet2DQcRmF';
const POLL_INTERVAL = 1000; // 1 second
const MAX_POLL_ATTEMPTS = 60; // 1 minute maximum wait

async function pollFileBatch(vectorStoreId, batchId) {
  let attempts = 0;
  
  while (attempts < MAX_POLL_ATTEMPTS) {
    const batch = await openai.beta.vectorStores.fileBatches.retrieve(
      vectorStoreId,
      batchId
    );

    logger.debug('Polling file batch:', {
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

export async function PrepareAndUpsertFile(debateData, analysis, uniqueSpeakers) {
  let tempFilePath;
  
  try {
    // Extract metadata
    const overview = debateData.overview || debateData.debate?.overview || {};

    // Format content as structured text
    const metadataText = [
      '=== METADATA ===',
      `Title: ${overview.Title}`,
      `Type: ${overview.Type}`,
      `House: House of ${overview.House}`,
      `Date: ${overview.Date.split('T')[0]}`,
      `Day: ${new Date(overview.Date).toLocaleString('en-GB', { weekday: 'long' })}`,
      `${overview.StartTime ? `Time: ${overview.StartTime}` : ''}`,
      '',
      '=== SPEAKERS ===',
      ...uniqueSpeakers.map(speaker => 
        [
          `Name: ${speaker.name || ''}`,
          speaker.party ? `Party: ${speaker.party}` : '',
          speaker.constituency ? `Constituency: ${speaker.constituency}` : '',
          speaker.role ? `Role: ${speaker.role}` : '',
          ''
        ].filter(line => line).join('\n')
      ),
      ''
    ].join('\n');

    // Format analysis content
    const analysisText = analysis.analysis 
      ? [
          '=== ANALYSIS ===',
          analysis.analysis,
          ''
        ].join('\n')
      : '';

    // Format speaker contributions
    const contributionsText = analysis.speaker_points
      ? [
          '=== CONTRIBUTIONS ===',
          ...analysis.speaker_points.map(speakerPoint => 
            [
              `SPEAKER: ${speakerPoint.speaker.name} (${speakerPoint.speaker.party})`,
              ...speakerPoint.contributions.map(contribution => 
                [
                  'CONTRIBUTION:',
                  contribution.point,
                  `Keywords: ${contribution.keywords.join(', ')}`,
                  ''
                ].join('\n')
              )
            ].join('\n')
          ),
          ''
        ].join('\n')
      : '';

    // Combine all sections
    const fullText = [
      metadataText,
      analysisText,
      contributionsText
    ].join('\n');

    logger.debug('Preparing text content:', {
      debateId: overview.ExternalId,
      contentLength: fullText.length,
      sections: {
        metadata: metadataText.length,
        analysis: analysisText.length,
        contributions: contributionsText.length
      }
    });

    // Create temporary file
    tempFilePath = path.join(os.tmpdir(), `debate-${overview.ExternalId || Date.now()}.txt`);
    fs.writeFileSync(tempFilePath, fullText);

    // Upload file using temporary file
    const file = await openai.files.create({
      file: fs.createReadStream(tempFilePath),
      purpose: 'assistants'
    });

    // Create file batch and poll for completion
    const batch = await openai.beta.vectorStores.fileBatches.create(
      VECTOR_STORE_ID,
      { file_ids: [file.id] }
    );

    await pollFileBatch(VECTOR_STORE_ID, batch.id);

    return file.id;

  } catch (error) {
    logger.error('Vector store process error:', {
      error: error.message,
      debateId: debateData?.ExternalId || debateData?.debate?.ExternalId,
      stack: error.stack
    });
    throw error;
  } finally {
    // Clean up temporary file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        logger.debug('Temporary file cleaned up:', { tempFilePath });
      } catch (cleanupError) {
        logger.warn('Failed to clean up temporary file:', {
          error: cleanupError.message,
          tempFilePath
        });
      }
    }
  }
}