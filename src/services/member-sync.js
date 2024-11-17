import { HansardAPI } from './hansard-api.js';
import { SupabaseService } from './supabase.js';
import logger from '../utils/logger.js';

export class MemberSync {
  static async syncAllMembers() {
    try {
      let skip = 0;
      let totalProcessed = 0;
      let hasMore = true;

      const searchParams = {
        includeCurrent: true,
        includeFormer: true
      };

      while (hasMore) {
        logger.info('Fetching members batch:', { skip, totalProcessed });
        
        const response = await HansardAPI.searchMembers(searchParams, skip);
        
        if (!response.Results || response.Results.length === 0) {
          hasMore = false;
          break;
        }

        // Transform the data to match our schema exactly
        const promises = response.Results.map(member => {
          return SupabaseService.upsertMember({
            member_id: member.MemberId,
            display_as: member.DisplayAs,
            full_title: member.FullTitle,
            gender: member.Gender,
            party: member.Party,
            house: member.House,
            member_from: member.MemberFrom,
            house_start_date: member.HouseStartDate,
            house_end_date: member.HouseEndDate,
            constituency_country: member.ConstituencyCountry
          });
        });

        await Promise.all(promises);

        totalProcessed += response.Results.length;
        skip += response.Results.length;

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info('Member sync completed', { totalProcessed });
      return totalProcessed;

    } catch (error) {
      logger.error('Member sync failed:', error);
      throw error;
    }
  }
}