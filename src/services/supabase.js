import { createClient } from '@supabase/supabase-js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);

export class SupabaseService {
  static async upsertDebate(debate, aiProcess = null) {
    try {
      // If only divisions processing is specified, skip debate upsert
      if (aiProcess && aiProcess.length === 1 && aiProcess.includes('divisions')) {
        logger.debug('Skipping debate upsert - only divisions processing specified');
        return null;
      }

      // Get existing debate data first
      const { data: existingDebate, error: fetchError } = await supabase
        .from('debates')
        .select(`
          ai_title,
          ai_summary,
          ai_overview,
          ai_tone,
          ai_topics,
          ai_key_points,
          ai_comment_thread,
          ai_question,
          ai_question_topic,
          ai_question_subtopics
        `)
        .eq('ext_id', debate.ext_id)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') { // Not found is ok
        throw fetchError;
      }

      // Merge existing AI content with new content, preserving existing values
      const mergedDebate = {
        ...debate,
        ...(existingDebate && {
          ai_title: debate.ai_title ?? existingDebate.ai_title,
          ai_summary: debate.ai_summary ?? existingDebate.ai_summary,
          ai_overview: debate.ai_overview ?? existingDebate.ai_overview,
          ai_tone: debate.ai_tone ?? existingDebate.ai_tone,
          ai_topics: debate.ai_topics ?? existingDebate.ai_topics,
          ai_key_points: debate.ai_key_points ?? existingDebate.ai_key_points,
          ai_comment_thread: debate.ai_comment_thread ?? existingDebate.ai_comment_thread,
          ai_question: debate.ai_question ?? existingDebate.ai_question,
          ai_question_topic: debate.ai_question_topic ?? existingDebate.ai_question_topic,
          ai_question_subtopics: debate.ai_question_subtopics ?? existingDebate.ai_question_subtopics
        })
      };

      // Perform the upsert with merged data
      const { data, error } = await supabase
        .from('debates')
        .upsert(mergedDebate, {
          onConflict: ['ext_id'],
          returning: 'representation',
          conflictTarget: 'ext_id'
        });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Supabase upsert error:', error);
      throw error;
    }
  }

  static async upsertDivisions(divisions) {
    try {
      const { data, error } = await supabase
        .from('divisions')
        .upsert(divisions, {
          onConflict: ['debate_section_ext_id', 'division_number'],
          returning: true
        });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to upsert divisions:', error);
      return { data: null, error };
    }
  }

  // In supabase.js
  static async getExistingDebateContent(externalId) {
    try {
      const { data, error } = await supabase
        .from('debates')
        .select('ai_summary, ai_topics, ai_key_points, ai_question, ai_comment_thread')
        .eq('ext_id', externalId)
        .single();

      if (error) throw error;
      return data || {};
    } catch (error) {
      logger.error('Failed to get existing debate content:', error);
      return {};
    }
  }

  static async getLastProcessedDate() {
    try {
      const { data, error } = await supabase
        .from('debates')
        .select('date')
        .order('date', { ascending: false })
        .limit(1);

      if (error) throw error;
      return data[0]?.date;
    } catch (error) {
      logger.error('Failed to get last processed date:', error);
      throw error;
    }
  }

  static async getDebateIds(externalIds) {
    try {
      const { data, error } = await supabase
        .from('debates')
        .select('ext_id')
        .in('ext_id', externalIds);

      if (error) throw error;
      return data.map(d => d.ext_id);
    } catch (error) {
      logger.error('Failed to get debate IDs:', error);
      throw error;
    }
  }

  static async upsertMember(member) {
    try {
      const { data, error } = await supabase
        .from('members')
        .upsert(member, {
          onConflict: ['member_id'],
          returning: 'representation',
          conflictTarget: 'member_id'
        });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to upsert member:', error);
      throw error;
    }
  }

  static async getMemberDetails(memberIds) {
    try {
      const { data, error } = await supabase
        .from('members')
        .select('member_id, display_as, party, constituency')
        .in('member_id', memberIds);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to get member details:', error);
      return { data: [], error };
    }
  }

  static async getMembersWithoutTwfyId() {
    try {
      const { data, error } = await supabase
        .from('members')
        .select('member_id, display_as')
        .is('twfy_id', null);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to get members without TWFY ID:', error);
      return { data: [], error };
    }
  }

  static async updateMemberTwfy({ memberId, twfyId, twfyUrl }) {
    try {
      const { data, error } = await supabase
        .from('members')
        .update({
          twfy_id: twfyId,
          twfy_url: twfyUrl,
          updated_at: new Date().toISOString()
        })
        .eq('member_id', memberId)
        .select();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to update member TWFY details:', error);
      return { data: null, error };
    }
  }

  static async getDebates() {
    try {
      const { data, error } = await supabase
        .from('debates')
        .select('ext_id, title')
        .order('date', { ascending: false });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to get debates:', error);
      return { data: [], error };
    }
  }

  static async updateDebateSpeakers({ ext_id, speakers, speaker_count }) {
    try {
      const { data, error } = await supabase
        .from('debates')
        .update({ 
          speakers,
          speaker_count,
          updated_at: new Date().toISOString()
        })
        .eq('ext_id', ext_id)
        .select();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to update debate speakers:', error);
      return { data: null, error };
    }
  }

  static async getCurrentWeekDebates() {
    try {
      const { data, error } = await supabase
        .from('debates')
        .select('*')
        .gte('date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('date', { ascending: true });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to get current week debates:', error);
      return { data: [], error };
    }
  }

  static async upsertEmbedding(debateId, embedding) {
    try {
      const { data, error } = await supabase
        .from('debate_embeddings')
        .upsert({
          debate_id: debateId,
          embedding,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'debate_id',
          returning: true
        });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to upsert embedding:', error);
      return { data: null, error };
    }
  }

  static async getDebatesWithoutEmbeddings() {
    try {
      const { data: embeddingIds, error: embeddingError } = await supabase
        .from('debate_embeddings')
        .select('debate_id');

      if (embeddingError) throw embeddingError;

      const embeddingIdList = embeddingIds.map(e => e.debate_id);

      const query = supabase
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
        `);

      if (embeddingIdList.length > 0) {
        query.not('id', 'in', embeddingIdList);
      }

      const { data, error } = await query;

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to get debates without embeddings:', error);
      return { data: [], error };
    }
  }

  static async getDebateByExtId(extId) {
    try {
      const { data, error } = await supabase
        .from('debates')
        .select('*')
        .eq('ext_id', extId)
        .limit(1);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to get debate by ext_id:', error);
      return { data: null, error };
    }
  }

  static async updateDebateFileId({ extId, fileId }) {
    try {
      const { data, error } = await supabase
        .from('debates')
        .update({ 
          file_id: fileId,
          updated_at: new Date().toISOString()
        })
        .eq('ext_id', extId)
        .select();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to update debate file_id:', error);
      return { data: null, error };
    }
  }

  static async getDebatesWithoutFileChunks() {
    try {
      const { data: chunkedDebates, error: chunksError } = await supabase
        .from('debate_file_chunks')
        .select('debate_id');

      if (chunksError) throw chunksError;

      const chunkedDebateIds = chunkedDebates.map(d => d.debate_id);

      const query = supabase
        .from('debates')
        .select('*')
        .order('date', { ascending: false });

      if (chunkedDebateIds.length > 0) {
        query.not('id', 'in', chunkedDebateIds);
      }

      const { data, error } = await query;

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to get debates without file chunks:', error);
      return { data: [], error };
    }
  }

  static async getDebatesWithMissingContent(pageSize = 10, startRange = 0) {
    try {
      const { data, error } = await supabase
        .from('debates')
        .select(`
          ext_id,
          overview,
          ai_summary,
          ai_topics,
          ai_key_points,
          ai_comment_thread,
          ai_question,
          divisions (
            id,
            ai_question,
            ai_topic,
            ai_context,
            ai_key_arguments
          )
        `)
        .eq('divisions.debate_section_ext_id', 'debates.ext_id')
        .or(
          'ai_summary.is.null,' +
          'ai_topics.is.null,' +
          'ai_key_points.is.null,' +
          'ai_comment_thread.is.null,' +
          'ai_question.is.null'
        )
        .order('date', { ascending: false })
        .range(startRange, startRange + pageSize - 1)
        .limit(pageSize);

      if (error) throw error;

      const debugInfo = data?.map(debate => ({
        ext_id: debate.ext_id,
        missing_fields: [
          !debate.ai_summary && 'ai_summary',
          !debate.ai_topics && 'ai_topics',
          !debate.ai_key_points && 'ai_key_points',
          !debate.ai_comment_thread && 'ai_comment_thread',
          !debate.ai_question && 'ai_question',
          debate.divisions?.some(d => !d.ai_question) && 'division_questions'
        ].filter(Boolean)
      }));

      logger.debug('Found debates with missing content:', {
        count: data?.length,
        range: `${startRange}-${startRange + pageSize - 1}`,
        sample: debugInfo?.[0],
      });

      return { 
        data, 
        error: null,
        hasMore: data?.length === pageSize
      };
    } catch (error) {
      logger.error('Failed to fetch debates with missing content:', {
        error: error.message,
        stack: error.stack
      });
      return { data: null, error };
    }
  }
}

export { supabase }; 