import { OpenAIService } from './openai.js';
import { SupabaseService } from './supabase.js';
import { supabase } from './supabase.js';
import logger from '../utils/logger.js';

export class EmbeddingService {
  static prepareDebateChunks(debate) {
    const chunks = [];

    // Add summary as a chunk
    if (debate.ai_summary) {
      chunks.push({
        debate_id: debate.id,
        chunk_text: debate.ai_summary,
        chunk_type: 'summary'
      });
    }

    // Add key points as chunks
    if (debate.ai_key_points) {
      debate.ai_key_points.forEach(kp => {
        const speaker = debate.speakers?.[kp.speaker_id];
        chunks.push({
          debate_id: debate.id,
          chunk_text: kp.point,
          chunk_type: 'key_point',
          speaker_id: kp.speaker_id,
          speaker_name: speaker?.display_as,
          speaker_party: speaker?.party
        });
      });
    }

    return chunks;
  }

  static async generateAndStoreChunkEmbeddings({ extId }) {
    try {
      // Get the specific debate from Supabase
      const { data: debates, error } = await supabase
        .from('debates')
        .select(`
          id,
          ext_id,
          title,
          ai_summary,
          ai_key_points,
          ai_topics,
          type,
          date,
          speakers
        `)
        .eq('ext_id', extId)
        .limit(1);

      if (error) throw error;
      
      if (!debates || debates.length === 0) {
        logger.info(`No debate found with ext_id ${extId}`);
        return;
      }

      const debate = debates[0];
      const chunks = this.prepareDebateChunks(debate);
      
      for (const chunk of chunks) {
        try {
          const embedding = await OpenAIService.generateEmbedding(chunk.chunk_text);
          
          await supabase
            .from('debate_chunks')
            .upsert({
              ...chunk,
              embedding
            });
          
          logger.info(`Generated embedding for chunk in debate ${debate.ext_id}`);
        } catch (error) {
          logger.error(`Failed to process chunk in debate ${debate.ext_id}:`, error);
        }
      }
    } catch (error) {
      logger.error('Failed to generate chunk embeddings:', error);
      throw error;
    }
  }
} 