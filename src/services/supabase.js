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
      const { data, error } = await supabase
        .from('divisions')
        .upsert(divisions, {
          onConflict: 'division_id',
          returning: true
        });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('Failed to upsert divisions:', error);
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
}

export { supabase }; 