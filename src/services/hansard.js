import { HansardAPI } from './hansard-api.js';
import logger from '../utils/logger.js';

export class HansardService {
  static async getLatestDebates() {
    try {
      // Get latest sitting date
      const latestDate = await HansardAPI.getLastSittingDate();
      
      // Get debates from both houses
      const [commonsDebates, lordsDebates] = await Promise.all([
        this.getHouseDebates(latestDate, 'Commons'),
        this.getHouseDebates(latestDate, 'Lords')
      ]);

      logger.info(`Found ${commonsDebates.length} Commons debates and ${lordsDebates.length} Lords debates`);

      // Combine and filter valid debates
      const allDebates = [...commonsDebates, ...lordsDebates].filter(debate => 
        debate && debate.ExternalId && debate.Title
      );

      return allDebates;
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