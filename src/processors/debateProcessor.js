import { HansardService } from '../services/hansard.js';
import logger from '../utils/logger.js';
import { getTypeSpecificPrompt, formatDebateContext } from '../utils/debateUtils.js';
import { generateAnalysis } from './generateAnalysis.js';
import { upsertResultsToVectorStore } from './upsertResultstoVectorStore.js';
import fs from 'fs';
import path from 'path';

export async function processDebates(
  specificDate = null,
  specificDebateId = null,
  processTypes = ['analysis'],
  debatesToProcess = []
) {
  try {
    logger.info('Starting debate processing:', {
      specificDate,
      specificDebateId,
      processTypes,
      debateCount: debatesToProcess.length,
      timestamp: new Date().toISOString()
    });

    if (!debatesToProcess.length) {
      logger.info('No debates to process');
      return [];
    }

    // Process debates sequentially but collect results for bulk upload
    const processedResults = [];
    const allSpeakers = new Set();
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < debatesToProcess.length; i++) {
      const debate = debatesToProcess[i];
      
      // For specific debate IDs, process the items to get member details
      if (specificDebateId && debate.Items) {
        // Create context object for processItems
        const context = {
          date: debate.Overview?.Date,
          house: debate.Overview?.House,
          section: debate.Overview?.Section
        };

        // Process the items to get member details
        const processedItems = await HansardService.processItems([{
          ExternalId: debate.Overview.ExtId,
          Title: debate.Overview.Title,
          Items: debate.Items
        }], context);

        // Use the first processed item (should only be one for specific ID)
        if (processedItems?.[0]) {
          debate.Items = processedItems[0].Items;
        }
      }

      logger.info(`Processing debate ${i + 1}/${debatesToProcess.length}:`, {
        id: debate.Overview?.ExtId,
        title: debate.Overview?.Title,
        type: debate.Overview?.Type,
        itemCount: debate.Items?.length
      });

      const processedDebate = {
        ext_id: debate.ExternalId,
        id: debate.ExternalId,
        context: formatDebateContext(debate.Overview, debate.Items),
        typePrompt: getTypeSpecificPrompt(debate.Overview?.Type),
        overview: debate.Overview
      };

      const startTime = Date.now();
      
      try {
        const debateSpeakers = extractUniqueSpeakers(debate);
        debateSpeakers.forEach(speaker => allSpeakers.add(speaker));

        logger.debug('Generating analysis:', {
          debateId: processedDebate.ext_id,
          speakerCount: debateSpeakers.size,
          contextLength: processedDebate.context.length
        });

        const analysis = await generateAnalysis(processedDebate, Array.from(debateSpeakers));

        // If this is a specific debate ID, store the raw output
        if (specificDebateId) {
          console.log(processedDebate.type)
          const outputDir = path.join(process.cwd(), 'debug_output');
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          const outputPath = path.join(outputDir, `${specificDebateId}_output.json`);
          fs.writeFileSync(outputPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            debate: processedDebate,
            speakers: Array.from(debateSpeakers),
            prompt: analysis._debug?.prompt,
            raw_analysis: analysis._debug?.raw_response || analysis
          }, null, 2));

          logger.info(`Stored debug output for debate ${specificDebateId}`, {
            path: outputPath
          });

          return [{ id: specificDebateId, status: 'debug_stored' }];
        }

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
        
        // If this is a specific debate ID, store the error output
        if (specificDebateId) {
          const outputDir = path.join(process.cwd(), 'debug_output');
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          const outputPath = path.join(outputDir, `${specificDebateId}_error.json`);
          fs.writeFileSync(outputPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            debate: processedDebate,
            prompt: error.prompt,
            error: {
              message: error.message,
              stack: error.stack,
              raw_response: error.raw_response || null
            }
          }, null, 2));

          logger.info(`Stored error output for debate ${specificDebateId}`, {
            path: outputPath
          });

          return [{ id: specificDebateId, status: 'error_stored' }];
        }

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

    // Only proceed with vector store updates if not processing a specific debate
    if (!specificDebateId && processedResults.length > 0) {
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
    }

    return processedResults;

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