import { createClient } from '@supabase/supabase-js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);

export class SupabaseService {
  static async upsertDebate(debate) {
    try {
      const { data, error } = await supabase
        .from('debates')
        .upsert(debate, {
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
}

export { supabase }; 