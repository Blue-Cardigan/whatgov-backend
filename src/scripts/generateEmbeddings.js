import { SupabaseService } from '../services/supabase.js';
import { createAndUploadVectorFile } from '../processors/embeddingsProcessor.js';
import { processAIContent } from '../processors/aiProcessor.js';
import logger from '../utils/logger.js';

async function processDebate(debate, memberDetails = new Map()) {
  try {
    // First generate AI content if needed
    if (!debate.ai_summary || !debate.ai_topics || !debate.ai_key_points) {
      const aiContent = await processAIContent(debate, memberDetails);
      
      // Update debate with AI content
      await SupabaseService.upsertDebate({
        ext_id: debate.ext_id,
        ai_summary: aiContent.summary,
        ai_topics: aiContent.topics,
        ai_key_points: aiContent.keyPoints,
        ai_title: aiContent.summary?.title,
        ai_overview: aiContent.summary?.overview,
        ai_tone: aiContent.summary?.tone,
        updated_at: new Date().toISOString()
      });

      // Update local debate object with new AI content
      debate = {
        ...debate,
        ai_summary: aiContent.summary,
        ai_topics: aiContent.topics,
        ai_key_points: aiContent.keyPoints,
        ai_title: aiContent.summary?.title,
        ai_overview: aiContent.summary?.overview,
        ai_tone: aiContent.summary?.tone
      };
    }

    // Format debate for vector generation
    const formattedDebate = formatDebateForVector(debate);

    // Generate embeddings
    const uploadedFile = await createAndUploadVectorFile(formattedDebate, memberDetails);
    if (!uploadedFile) {
      logger.error(`Failed to generate vectors for debate ${debate.ext_id}`);
      return false;
    }

    // Update the debate record with the file_id
    await SupabaseService.updateDebateFileId({
      extId: debate.ext_id,
      fileId: uploadedFile.id
    });

    logger.info(`Successfully processed debate ${debate.ext_id}`, {
      fileId: uploadedFile.id
    });
    return true;
  } catch (error) {
    logger.error('Error processing debate:', error);
    return false;
  }
}

async function processBatch(debates, batchSize = 5) {
  try {
    // Process debates in smaller chunks to avoid rate limits
    const results = [];
    for (let i = 0; i < debates.length; i += batchSize) {
      const batch = debates.slice(i, i + batchSize);
      
      logger.info(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(debates.length/batchSize)}`, {
        batchSize: batch.length,
        remaining: debates.length - (i + batch.length)
      });

      // Process batch concurrently
      const batchResults = await Promise.allSettled(
        batch.map(debate => processDebate(debate))
      );

      // Log batch results
      const successful = batchResults.filter(r => r.status === 'fulfilled' && r.value).length;
      const failed = batch.length - successful;
      
      results.push(...batchResults);

      logger.info(`Batch complete:`, {
        successful,
        failed,
        remaining: debates.length - (i + batchSize)
      });

      // Add delay between batches to avoid rate limits
      if (i + batchSize < debates.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return results;
  } catch (error) {
    logger.error('Error in batch processing:', error);
    throw error;
  }
}

function formatDebateForVector(debate) {
  return {
    Overview: {
      ExtId: debate.ext_id,
      Title: debate.title,
      Date: debate.date,
      Type: debate.type,
      Location: debate.location,
      House: debate.house
    },
    Items: [],
    summary: {
      title: debate.ai_title,
      overview: debate.ai_overview,
      summary: debate.ai_summary,
      tone: debate.ai_tone
    },
    keyPoints: {
      keyPoints: debate.ai_key_points
    },
    topics: debate.ai_topics,
    divisions: []
  };
}

async function main() {
  try {
    const extId = process.argv[2];

    if (extId) {
      // Process single debate
      const { data: debates, error } = await SupabaseService.getDebateByExtId(extId);
      if (error) throw error;
      if (!debates?.length) {
        logger.error(`No debate found with ext_id: ${extId}`);
        return;
      }
      await processDebate(debates[0]);
    } else {
      // Process all debates without vectors
      let offset = 0;
      const limit = 100;
      let hasMore = true;

      while (hasMore) {
        const { data: debates, error } = await SupabaseService.getDebatesWithMissingContent(limit, offset);
        if (error) throw error;

        if (!debates?.length) {
          hasMore = false;
          break;
        }

        logger.info(`Processing ${debates.length} debates starting from offset ${offset}`);
        await processBatch(debates);

        offset += limit;
        hasMore = debates.length === limit;
      }
    }

    logger.info('Processing complete');
  } catch (error) {
    logger.error('Processing failed:', error);
    throw error;
  }
}

// Run the script
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });