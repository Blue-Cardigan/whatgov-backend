import { HansardAPI } from './hansard-api.js';
import logger from '../utils/logger.js';
import { SupabaseService } from '../services/supabase.js';
import { getDebateType, validateDebateContent } from '../utils/transforms.js';

export class HansardService {
  static async getLatestDebates(options = {}) {
    try {
      options = options || {};
      const { specificDate, specificDebateId, aiProcess } = options;

      // Cache date checks to avoid redundant API calls
      if (!global.dateCache) {
        global.dateCache = {
          timestamp: Date.now(),
          lastProcessedDate: null,
          latestSittingDate: null
        };
      }

      // Refresh cache if older than 30 minutes
      if (Date.now() - global.dateCache.timestamp > 1800000) {
        global.dateCache = {
          timestamp: Date.now(),
          lastProcessedDate: await SupabaseService.getLastProcessedDate(),
          latestSittingDate: await HansardAPI.getLastSittingDate()
        };
      }

      logger.debug('Getting latest debates with options:', {
        specificDate,
        specificDebateId,
        aiProcess: aiProcess || 'all'
      });

      let dateToProcess;
      let existingIds = [];

      if (specificDebateId) {
        // Fetch a specific debate by its ID
        const debateDetails = await this.getDebateDetails(specificDebateId);
        if (!debateDetails) {
          logger.warn(`No debate found with ID: ${specificDebateId}`);
          return [];
        }
        logger.info(`Processing specific debate ID: ${specificDebateId}`);
        return [debateDetails];
      }

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

      // Add debate type and validate each debate
      const processedDebates = [...commonsDebates, ...lordsDebates]
        .map(debate => {
          if (debate?.Overview) {
            debate.Overview.Type = getDebateType(debate.Overview);
          }
          return debate;
        })
        .filter(debate => {
          const isValid = validateDebateContent(debate);
          if (!isValid) {
            logger.debug(`Filtered out invalid debate: ${debate?.ExternalId}`);
          }
          return isValid !== null;
        });

      // Pre-filter debates we already have in database
      try {
        existingIds = await SupabaseService.getDebateIds(
          processedDebates.map(d => d.ExternalId)
        );
      } catch (error) {
        logger.warn('Failed to get existing debate IDs from Supabase:', error);
      }

      // Filter out debates that already exist (unless reprocessing)
      const newDebates = processedDebates.filter(debate => 
        debate?.ExternalId && 
        debate?.Title &&
        (options.aiProcess || !existingIds.includes(debate.ExternalId))
      );

      logger.info(`Debates after filtering: ${newDebates.length}`);
      
      return newDebates;
    } catch (error) {
      logger.error('Failed to fetch latest debates:', error);
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