import { createClient } from '@supabase/supabase-js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);

export class SupabaseService {
  static async upsertDebate(debate, aiProcesses = null, divisions = null) {
    try {
      // If specific AI processes are requested, only update those fields
      if (aiProcesses) {

        // Only include AI fields for specified processes
        const aiFields = {};
        
        if (aiProcesses.includes('summary')) {
          if ('ai_title' in debate) aiFields.ai_title = debate.ai_title;
          if ('ai_summary' in debate) aiFields.ai_summary = debate.ai_summary;
          if ('ai_overview' in debate) aiFields.ai_overview = debate.ai_overview;
          if ('ai_tone' in debate) aiFields.ai_tone = debate.ai_tone;
        }

        if (aiProcesses.includes('topics')) {
          if ('ai_topics' in debate) aiFields.ai_topics = debate.ai_topics;
        }

        if (aiProcesses.includes('keypoints')) {
          if ('ai_key_points' in debate) aiFields.ai_key_points = debate.ai_key_points;
        }

        if (aiProcesses.includes('comments')) {
          if ('ai_comment_thread' in debate) aiFields.ai_comment_thread = debate.ai_comment_thread;
        }

        if (aiProcesses.includes('questions')) {
          if ('ai_question' in debate) aiFields.ai_question = debate.ai_question;
          if ('ai_question_topic' in debate) aiFields.ai_question_topic = debate.ai_question_topic;
          if ('ai_question_subtopics' in debate) aiFields.ai_question_subtopics = debate.ai_question_subtopics;
          if ('ai_question_ayes' in debate) aiFields.ai_question_ayes = debate.ai_question_ayes;
          if ('ai_question_noes' in debate) aiFields.ai_question_noes = debate.ai_question_noes;
        }

        console.log('Updating debate AI fields:', {
          debateId: debate.ext_id,
          aiFields: Object.keys(aiFields),
          requestedProcesses: aiProcesses
        });

        // Update only the specified AI fields
        const { error: debateError } = await supabase
          .from('debates')
          .update({
            ...aiFields,
            updated_at: new Date().toISOString()
          })
          .eq('ext_id', debate.ext_id);

        if (debateError) throw debateError;

      } else {
        // Full upsert with all fields
        console.log('Upserting full debate:', {
          debateId: debate.ext_id,
          fields: Object.keys(debate)
        });

        const { error: debateError } = await supabase
          .from('debates')
          .upsert({
            ...debate,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'ext_id',
            returning: 'minimal'
          });

        if (debateError) throw debateError;
      }

      // Handle divisions if present
      if (divisions?.length) {
        console.log('Upserting divisions:', {
          count: divisions.length,
          debateId: debate.ext_id
        });

        // If specific AI processes are requested, only update AI fields
        if (aiProcesses) {
          for (const division of divisions) {
            const updateFields = {
              updated_at: new Date().toISOString()
            };

            if (aiProcesses.includes('divisions')) {
              if ('ai_question' in division) updateFields.ai_question = division.ai_question;
              if ('ai_topic' in division) updateFields.ai_topic = division.ai_topic;
              if ('ai_context' in division) updateFields.ai_context = division.ai_context;
              if ('ai_key_arguments' in division) updateFields.ai_key_arguments = division.ai_key_arguments;
            }

            const { error } = await supabase
              .from('divisions')
              .update(updateFields)
              .eq('division_id', division.division_id);

            if (error) throw error;
          }
        } else {
          // Full division upsert
          const { error: divisionsError } = await supabase
            .from('divisions')
            .upsert(divisions, {
              onConflict: 'division_id',
              returning: 'minimal'
            });

          if (divisionsError) throw divisionsError;
        }
      }

      return { error: null };

    } catch (error) {
      logger.error('Failed to upsert debate:', {
        error: error.message,
        stack: error.stack,
        debateId: debate.ext_id,
        requestedProcesses: aiProcesses,
        divisionsCount: divisions?.length || 0
      });
      return { error };
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

  static async upsertDivisions(divisions) {
    try {
      if (!Array.isArray(divisions) || divisions.length === 0) {
        logger.warn('No divisions provided for upsert');
        return { data: null, error: new Error('No divisions provided') };
      }

      console.log('Attempting to upsert divisions:', {
        count: divisions.length,
        sampleDivision: {
          id: divisions[0]?.division_id,
          external_id: divisions[0]?.external_id,
          debate_id: divisions[0]?.debate_section_ext_id
        }
      });

      // Validate required fields
      const invalidDivisions = divisions.filter(d => !d.division_id || !d.external_id);
      if (invalidDivisions.length > 0) {
        logger.error('Invalid divisions found:', {
          count: invalidDivisions.length,
          sample: invalidDivisions[0]
        });
        return { 
          data: null, 
          error: new Error(`${invalidDivisions.length} divisions missing required fields`) 
        };
      }

      // Ensure all required fields are present and format data for Supabase
      const formattedDivisions = divisions.map(division => ({
        division_id: division.division_id,
        external_id: division.external_id,
        debate_section_ext_id: division.debate_section_ext_id,
        date: division.date,
        time: division.time,
        has_time: division.has_time,
        ayes_count: division.ayes_count,
        noes_count: division.noes_count,
        house: division.house,
        debate_section: division.debate_section,
        debate_section_source: division.debate_section_source,
        division_number: division.division_number,
        text_before_vote: division.text_before_vote,
        text_after_vote: division.text_after_vote,
        evel_type: division.evel_type,
        evel_info: division.evel_info,
        evel_ayes_count: division.evel_ayes_count,
        evel_noes_count: division.evel_noes_count,
        is_committee_division: division.is_committee_division,
        ai_question: division.ai_question,
        ai_topic: division.ai_topic,
        ai_context: division.ai_context,
        ai_key_arguments: division.ai_key_arguments,
        aye_members: division.aye_members || [],
        noe_members: division.noe_members || [],
        updated_at: new Date().toISOString()
      }));

      console.log('Formatted divisions for upsert:', {
        count: formattedDivisions.length,
        sample: {
          id: formattedDivisions[0]?.division_id,
          external_id: formattedDivisions[0]?.external_id
        }
      });

      const { data, error } = await supabase
        .from('divisions')
        .upsert(formattedDivisions, {
          onConflict: 'division_id',
          returning: true
        });

      if (error) {
        logger.error('Supabase division upsert error:', {
          error,
          firstDivisionId: divisions[0]?.division_id,
          count: divisions.length
        });
        return { data: null, error };
      }

      console.log('Successfully upserted divisions:', {
        count: data?.length,
        sample: data[0]?.division_id
      });

      return { data, error: null };
    } catch (error) {
      logger.error('Failed to upsert divisions:', {
        error: error.message,
        stack: error.stack,
        firstDivisionId: divisions[0]?.division_id,
        count: divisions.length
      });
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
      // First get the debate
      const { data: debate, error: debateError } = await supabase
        .from('debates')
        .select('*')
        .eq('ext_id', extId)
        .single();

      if (debateError) throw debateError;

      // Then get associated divisions
      const { data: divisions, error: divisionsError } = await supabase
        .from('divisions')
        .select(`
          debate_section_ext_id,
          ai_question,
          ai_topic,
          ai_context,
          ai_key_arguments
        `)
        .eq('debate_section_ext_id', extId);

      if (divisionsError) throw divisionsError;

      // Return combined data
      return {
        ...debate,
        divisions: divisions || []
      };

    } catch (error) {
      logger.error('Failed to get debate by ext_id:', {
        error: error.message,
        stack: error.stack,
        extId
      });
      return null;
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

      console.log('Found debates with missing content:', {
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

  static async upsertDebateWithDivisions(debate, divisions = null) {
    try {
      // First upsert the debate
      console.log('Upserting debate:', {
        ext_id: debate.ext_id,
        hasDivisions: !!divisions
      });

      const { error: debateError } = await supabase
        .from('debates')
        .upsert(debate, {
          onConflict: 'ext_id',
          returning: true
        });

      if (debateError) {
        logger.error('Failed to upsert debate:', {
          error: debateError,
          debateId: debate.ext_id
        });
        return { error: debateError };
      }

      // If we have divisions, upsert them as well
      if (divisions?.length) {
        console.log('Upserting divisions:', {
          count: divisions.length,
          debateId: debate.ext_id
        });

        const { error: divisionsError } = await supabase
          .from('divisions')
          .upsert(divisions, {
            onConflict: 'division_id',
            returning: true
          });

        if (divisionsError) {
          logger.error('Failed to upsert divisions:', {
            error: divisionsError,
            debateId: debate.ext_id,
            divisionsCount: divisions.length
          });
          return { error: divisionsError };
        }
      }

      console.log('Successfully upserted debate and divisions:', {
        debateId: debate.ext_id,
        divisionsCount: divisions?.length || 0
      });

      return { error: null };
    } catch (error) {
      logger.error('Failed to upsert debate with divisions:', {
        error: error.message,
        stack: error.stack,
        debateId: debate.ext_id,
        divisionsCount: divisions?.length || 0
      });
      return { error };
    }
  }
}

export { supabase }; 