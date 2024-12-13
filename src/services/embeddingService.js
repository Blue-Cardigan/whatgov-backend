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

  static chunkText(text, maxTokens = 800, overlapTokens = 400) {
    // Approximate characters based on tokens (4 chars ≈ 1 token)
    const chunkSize = maxTokens * 4;
    const overlapSize = overlapTokens * 4;
    
    const chunks = [];
    let startIndex = 0;
    
    while (startIndex < text.length) {
      let endIndex = startIndex + chunkSize;
      
      if (endIndex < text.length) {
        const searchWindow = text.slice(endIndex - overlapSize, endIndex);
        const lastSentenceEnd = Math.max(
          searchWindow.lastIndexOf('.'),
          searchWindow.lastIndexOf('?'),
          searchWindow.lastIndexOf('!')
        );
        
        if (lastSentenceEnd !== -1) {
          endIndex = endIndex - overlapSize + lastSentenceEnd + 1;
        }
      }
      
      const chunk = text.slice(startIndex, endIndex).trim();
      if (chunk) {
        chunks.push(chunk);
      }
      
      startIndex = endIndex - overlapSize;
    }
    
    return chunks;
  }

  static async generateAndStoreFileEmbedding({ content, debateId }) {
    try {
      // Split content into overlapping chunks
      const chunks = this.chunkText(content);

      logger.debug('Processing chunks for embeddings:', {
        debateId,
        chunkCount: chunks.length,
        totalContentLength: content.length
      });

      // Process chunks
      for (const [index, chunk] of chunks.entries()) {
        try {
          // Generate embedding for each chunk
          const embedding = await OpenAIService.generateEmbedding(chunk);

          // Upsert chunk using the composite primary key
          const { error } = await supabase
            .from('debate_file_chunks')
            .upsert({
              debate_id: debateId,
              chunk_index: index,
              chunk_text: chunk,
              embedding: embedding,
              token_count: chunk.split(/\s+/).length,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'debate_id,chunk_index'
            });

          if (error) {
            logger.error(`Failed to upsert chunk ${index}:`, {
              error: error.message,
              debateId,
              chunkIndex: index
            });
            throw error;
          }

          logger.info(`Stored embedding for chunk ${index} of debate ${debateId}`, {
            chunkLength: chunk.length,
            tokenCount: chunk.split(/\s+/).length
          });
        } catch (error) {
          logger.error(`Failed to process chunk ${index} of debate ${debateId}:`, {
            error: error.message,
            stack: error.stack,
            chunkLength: chunk.length
          });
          throw error;
        }
      }

      logger.info('Completed embedding generation and storage:', {
        debateId,
        totalChunks: chunks.length
      });

    } catch (error) {
      logger.error('Failed to generate and store file embeddings:', {
        error: error.message,
        stack: error.stack,
        debateId,
        cause: error.cause
      });
      throw error;
    }
  }
} 