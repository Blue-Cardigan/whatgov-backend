import { createClient } from '@supabase/supabase-js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);

export class SupabaseService {
  static async upsertDebate(debateOutput) {
    try {

      // Perform the upsert
      const { data, error } = await supabase
        .from('debates_new')
        .upsert(debateOutput, {
          onConflict: ['ext_id']
        });

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Supabase upsert error:', error);
      throw error;
    }
  }

  static async updateDebateFileIds({ extId, fileId }) {
    try {
      const { data, error } = await supabase
        .from('debates_new')
        .update({ 
          file_id: fileId,  // Single file ID
          updated_at: new Date().toISOString()
        })
        .eq('ext_id', extId)
        .select();

      if (error) {
        logger.error('Failed to update debate file_id:', {
          error: error.message,
          extId,
          fileId
        });
        throw error;
      }

      logger.debug('Updated debate file ID:', {
        extId,
        fileId
      });

      return { data, error: null };
    } catch (error) {
      logger.error('Failed to update debate file_id:', {
        error: error.message,
        stack: error.stack,
        extId
      });
      throw error;
    }
  }

  static async getLastProcessedDate() {
    try {
      const { data, error } = await supabase
        .from('debates_new')
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
        .select('member_id, display_as, party, constituency, department')
        .in('member_id', memberIds);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to get member details:', error);
      return { data: [], error };
    }
  }

  static async getDebateByExtId(extId) {
    try {
      const { data, error } = await supabase
        .from('debates_new')
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

  static async batchUpsertDebates(debates) {
    try {
      logger.debug('Batch upserting debates:', {
        count: debates.length,
        ids: debates.map(d => d.ext_id)
      });

      const { data, error } = await supabase
        .from('debates_new')
        .upsert(debates, {
          onConflict: ['ext_id'],
          returning: true
        });

      if (error) {
        logger.error('Batch upsert failed:', {
          error: error.message,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }

      if (!data) {
        console.log('Upsert succeeded');
        return true;  // Return the original data since upsert succeeded
      }

      logger.debug('Successfully batch upserted debates:', {
        count: data.length,
        ids: data.map(d => d.ext_id)
      });

      return data;
    } catch (error) {
      logger.error('Failed to batch upsert debates:', {
        error: error.message,
        stack: error.stack,
        debates: debates.map(d => ({ ext_id: d.ext_id, title: d.title }))
      });
      throw error;
    }
  }

  static async getCurrentVectorStore(startDate) {
    try {
      logger.debug('Fetching current vector store for start date:', startDate);
      
      const { data, error } = await supabase
        .from('vector_stores')
        .select('*')
        .eq('start_date', startDate)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        logger.error('Failed to fetch current vector store:', {
          error: error.message,
          details: error.details,
          startDate
        });
        throw error;
      }

      if (!data || data.length === 0) {
        logger.debug('No vector store found for start date:', startDate);
        return null;
      }

      logger.debug('Found vector store:', {
        store_id: data[0].store_id,
        store_name: data[0].store_name,
        start_date: data[0].start_date,
        end_date: data[0].end_date
      });

      return data[0];
    } catch (error) {
      logger.error('Error in getCurrentVectorStore:', {
        error: error.message,
        stack: error.stack,
        startDate
      });
      throw error;
    }
  }

  static async createWeeklyVectorStore(storeId, startDate, endDate, assistantId) {
    try {
      logger.debug('Creating new weekly vector store:', {
        store_id: storeId,
        assistant_id: assistantId,
        start_date: startDate,
        end_date: endDate
      });

      // Deactivate previous stores
      const { error: updateError } = await supabase
        .from('vector_stores')
        .update({ is_active: false })
        .eq('is_active', true);

      if (updateError) {
        logger.error('Failed to deactivate previous stores:', updateError);
        throw updateError;
      }

      // Create new store record
      const { data, error } = await supabase
        .from('vector_stores')
        .insert({
          store_id: storeId,
          assistant_id: assistantId,
          store_name: `Weekly Debates ${startDate.toISOString().split('T')[0]}`,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          is_active: true
        })
        .select()
        .single();

      if (error) {
        logger.error('Failed to create vector store record:', {
          error: error.message,
          details: error.details
        });
        throw error;
      }

      logger.debug('Successfully created weekly vector store:', {
        store_id: data.store_id,
        assistant_id: data.assistant_id,
        store_name: data.store_name
      });

      return data;
    } catch (error) {
      logger.error('Error in createWeeklyVectorStore:', {
        error: error.message,
        stack: error.stack,
        store_id: storeId,
        assistant_id: assistantId
      });
      throw error;
    }
  }
}

export { supabase }; 