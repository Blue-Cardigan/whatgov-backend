import { HansardService } from '../services/hansard.js';
import logger from '../utils/logger.js';
import { getTypeSpecificPrompt, formatDebateContext } from '../utils/debateUtils.js';
import { generateAnalysis } from './generateAnalysis.js';
import { upsertResultsToVectorStore } from './upsertResultstoVectorStore.js';

export async function processDebates(specificDate = null, specificDebateId = null) {
  try {
    let debatesToProcess = [];
    
    // Log initial processing parameters
    logger.info('Starting debate processing:', {
      specificDate,
      specificDebateId,
      timestamp: new Date().toISOString()
    });
    
    if (specificDebateId) {
      try {
        const debate = await HansardService.fetchDebate(specificDebateId);
        
        if (!debate) {
          throw new Error('No debate data returned');
        }

        logger.debug('Fetched specific debate:', {
          id: specificDebateId,
          title: debate.Title,
          itemCount: debate.Items?.length
        });
        
        debatesToProcess = [{
          ExternalId: specificDebateId,
          debate
        }];
        
      } catch (error) {
        logger.error(`Failed to fetch specific debate ${specificDebateId}:`, {
          error: error.message,
          stack: error.stack
        });
        return false;
      }
    } else {
      debatesToProcess = await HansardService.getLatestDebates({
        specificDate
      });
    }

    if (!debatesToProcess.length) {
      logger.info('No debates to process');
      return true;
    }

    logger.info('Beginning debate processing:', {
      totalDebates: debatesToProcess.length,
      startTime: new Date().toISOString()
    });

    // Process debates sequentially but collect results for bulk upload
    const processedResults = [];
    const allSpeakers = new Set();
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < debatesToProcess.length; i++) {
      const debate = debatesToProcess[i];
      const debateData = debate.debate || debate;
      
      logger.info(`Processing debate ${i + 1}/${debatesToProcess.length}:`, {
        id: debate.ExternalId,
        title: debateData.Overview?.Title,
        type: debateData.Overview?.Type
      });

      // Format debate for processing
      const processedDebate = {
        ext_id: debate.ExternalId,
        id: debate.ExternalId,
        context: formatDebateContext(debateData.Overview, debateData.Items),
        typePrompt: getTypeSpecificPrompt(debateData.Overview?.Type),
        overview: debateData.Overview
      };

      const startTime = Date.now();
      
      try {
        // Extract unique speakers
        const debateSpeakers = extractUniqueSpeakers(debateData);
        debateSpeakers.forEach(speaker => allSpeakers.add(speaker));

        logger.debug('Generating analysis:', {
          debateId: processedDebate.ext_id,
          speakerCount: debateSpeakers.size,
          contextLength: processedDebate.context.length
        });

        const analysis = await generateAnalysis(processedDebate, Array.from(debateSpeakers));

        const processingTime = Date.now() - startTime;
        
        logger.info('Successfully processed debate:', {
          debateId: processedDebate.ext_id,
          processingTimeMs: processingTime,
          analysisLength: analysis.analysis.length,
          speakerPointsCount: analysis.speaker_points.length
        });

        processedResults.push({
          debate: processedDebate,
          analysis,
          speakers: Array.from(debateSpeakers)
        });

        successCount++;

      } catch (error) {
        failureCount++;
        logger.error(`Failed to process debate ${processedDebate.ext_id}:`, {
          error: error.message,
          stack: error.stack,
          processingTimeMs: Date.now() - startTime,
          progress: `${i + 1}/${debatesToProcess.length}`
        });
        continue;
      }

      // Progress summary every 5 debates or at the end
      if ((i + 1) % 5 === 0 || i === debatesToProcess.length - 1) {
        logger.info('Processing progress:', {
          processed: i + 1,
          total: debatesToProcess.length,
          successful: successCount,
          failed: failureCount,
          remainingDebates: debatesToProcess.length - (i + 1),
          totalSpeakers: allSpeakers.size
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (processedResults.length === 0) {
      logger.warn('No debates were successfully processed:', {
        totalAttempted: debatesToProcess.length,
        failures: failureCount
      });
      return [];
    }

    // Bulk upsert to vector store
    logger.info('Beginning vector store upsert:', {
      debateCount: processedResults.length,
      totalSpeakers: allSpeakers.size,
      successRate: `${((successCount / debatesToProcess.length) * 100).toFixed(1)}%`
    });

    const debates = processedResults.map(r => r.debate);
    const analyses = processedResults.map(r => r.analysis);
    
    const vectorStoreResults = await upsertResultsToVectorStore(
      debates,
      analyses,
      Array.from(allSpeakers)
    );

    logger.info('Processing completed:', {
      totalProcessed: debatesToProcess.length,
      successful: successCount,
      failed: failureCount,
      vectorStoreUpdates: vectorStoreResults.length,
      endTime: new Date().toISOString()
    });

    return vectorStoreResults;

  } catch (error) {
    logger.error('Failed to process debates:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

function extractUniqueSpeakers(debateData) {
  // Implement speaker extraction based on your data structure
  const speakers = new Set();
  
  if (debateData.Items) {
    debateData.Items.forEach(item => {
      if (item.Speaker) {
        speakers.add({
          name: item.Speaker.Name,
          party: item.Speaker.Party,
          constituency: item.Speaker.Constituency,
          role: item.Speaker.Role
        });
      }
    });
  }
  
  return speakers;
}