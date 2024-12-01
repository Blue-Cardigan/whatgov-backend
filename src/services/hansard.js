import { HansardAPI } from './hansard-api.js';
import logger from '../utils/logger.js';
import { SupabaseService } from '../services/supabase.js';

export class HansardService {
  static async getLatestDebates(specificDate = null) {
    try {
      let dateToProcess;
      let existingIds = [];

      if (specificDate) {
        dateToProcess = specificDate;
        logger.info(`Processing specific date: ${dateToProcess}`);
      } else {
        // First get latest processed date from Supabase
        try {
          const lastProcessedDate = await SupabaseService.getLastProcessedDate();
          
          // Get latest sitting date
          const latestDate = await HansardAPI.getLastSittingDate();
          
          // Only fetch debates if we have new content
          if (lastProcessedDate && new Date(lastProcessedDate) >= new Date(latestDate)) {
            logger.info('No new debates to process');
            return [];
          }
          
          dateToProcess = latestDate;
        } catch (error) {
          logger.warn('Failed to get last processed date, continuing with current date:', {
            error: error.message
          });
          // Fallback to current date if Supabase is unavailable
          dateToProcess = new Date().toISOString().split('T')[0];
        }
      }

      // Get debates from both houses
      const [commonsDebates, lordsDebates] = await Promise.all([
        this.getHouseDebates(dateToProcess, 'Commons'),
        this.getHouseDebates(dateToProcess, 'Lords')
      ]);

      logger.info(`Fetched ${commonsDebates.length} Commons debates and ${lordsDebates.length} Lords debates for ${dateToProcess}`);

      // Pre-filter debates we already have in database
      try {
        existingIds = await SupabaseService.getDebateIds(
          [...commonsDebates, ...lordsDebates].map(d => d.ExternalId)
        );
      } catch (error) {
        logger.warn('Failed to get existing debate IDs from Supabase, processing all debates:', {
          error: error.message
        });
        // Continue without filtering if Supabase is unavailable
      }

      const allDebates = [...commonsDebates, ...lordsDebates];
      logger.info(`Total debates before filtering: ${allDebates.length}`);
      
      // Log debates without ExternalId or Title
      const invalidDebates = allDebates.filter(debate => !debate?.ExternalId || !debate?.Title);
      if (invalidDebates.length > 0) {
        logger.warn(`Found ${invalidDebates.length} debates with missing ExternalId or Title`);
      }

      // Log debates that already exist
      const existingDebatesCount = allDebates.filter(d => existingIds.includes(d.ExternalId)).length;
      if (existingDebatesCount > 0) {
        logger.info(`Found ${existingDebatesCount} debates that already exist in database`);
      }

      // Filter out existing debates and invalid ones
      const newDebates = allDebates.filter(debate => 
        debate?.ExternalId && 
        debate?.Title &&
        (!existingIds.length || !existingIds.includes(debate.ExternalId))
      );

      logger.info(`Debates after filtering: ${newDebates.length}`);
      
      return newDebates;
    } catch (error) {
      logger.error('Failed to fetch latest debates:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  static async getHouseDebates(date, house) {
    try {
      const debates = await HansardAPI.getDebatesList(date, house);
      logger.info(`Fetched ${debates.length} ${house} debates for ${date}`);
      return debates;
    } catch (error) {
      logger.error(`Failed to fetch ${house} debates:`, error);
      return [];
    }
  }

  static async getDebateDetails(debateId) {
    try {
      const details = await HansardAPI.getDebateDetails(debateId);
      if (!details?.debate?.Overview) {
        throw new Error('Invalid debate details structure');
      }
      return details;
    } catch (error) {
      logger.error(`Failed to fetch debate details for ${debateId}:`, {
        error: error.message,
        stack: error.stack,
        details: error.details || {}
      });
      throw error;
    }
  }
} 