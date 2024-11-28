import logger from '../utils/logger.js';

const HANSARD_API_BASE = 'https://hansard-api.parliament.uk';

export class HansardAPI {
  static async fetchWithErrorHandling(url, retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second

    try {
      // Add delay before each request
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 429 || response.status === 400) {
          if (retryCount < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
            return this.fetchWithErrorHandling(url, retryCount + 1);
          }
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return response.json();
    } catch (error) {
      logger.error('API fetch error:', {
        error: error.message,
        stack: error.stack,
        url,
        retryCount
      });
      throw error;
    }
  }

  static async fetchSectionTrees(config) {
    const url = `${HANSARD_API_BASE}/overview/sectiontrees.${config.format}?` + 
      new URLSearchParams({
        house: config.house,
        date: config.date,
        section: config.section
      });

    return this.fetchWithErrorHandling(url);
  }

  static async fetchDebate(debateSectionExtId) {
    const url = `${HANSARD_API_BASE}/debates/debate/${debateSectionExtId}.json`;
    return this.fetchWithErrorHandling(url);
  }

  static async fetchSpeakers(debateSectionExtId) {
    const url = `${HANSARD_API_BASE}/debates/speakerslist/${debateSectionExtId}.json`;
    return this.fetchWithErrorHandling(url);
  }

  static async getLastSittingDate(house) {
    try {
      if (house) {
        const url = `${HANSARD_API_BASE}/overview/lastsittingdate.json?` +
          new URLSearchParams({ house });
        const response = await this.fetchWithErrorHandling(url);
        return response.replace(/"/g, '').trim(); // Remove quotes and whitespace
      }

      // Fetch both houses in parallel
      const [commonsDate, lordsDate] = await Promise.all([
        this.getLastSittingDate('Commons'),
        this.getLastSittingDate('Lords')
      ]);

      // Return the most recent date
      return new Date(commonsDate) > new Date(lordsDate) ? commonsDate : lordsDate;
    } catch (error) {
      logger.error('Failed to fetch last sitting date:', {
        error: error.message,
        stack: error.stack,
        house
      });
      throw error;
    }
  }

  static async getAvailableSections(date, house) {
    try {
      const url = `${HANSARD_API_BASE}/overview/sectionsforday.json?` +
        new URLSearchParams({ date, house });
      const sections = await this.fetchWithErrorHandling(url);
      return sections;
    } catch (error) {
      logger.error('Failed to fetch available sections:', {
        error: error.message,
        stack: error.stack,
        date,
        house
      });
      throw error;
    }
  }

  static async getDebatesList(date, house = 'Commons') {
    try {
      const targetDate = date || await this.getLastSittingDate();
      let currentDate = new Date(targetDate);
      let attempts = 0;
      const MAX_ATTEMPTS = 5;

      while (attempts < MAX_ATTEMPTS) {
        const formattedDate = currentDate.toISOString().split('T')[0];

        // Get available sections for both houses in parallel
        const [commonsDebates, lordsDebates] = await Promise.all([
          this.processHouseDebates(formattedDate, 'Commons'),
          this.processHouseDebates(formattedDate, 'Lords')
        ]);

        // If either house has debates, return results for the specified house
        if (commonsDebates.length > 0 || lordsDebates.length > 0) {
          return house === 'Commons' ? commonsDebates : lordsDebates;
        }

        logger.info('No debates found, trying previous day:', { 
          date: formattedDate, 
          attemptNumber: attempts + 1 
        });
        
        currentDate.setDate(currentDate.getDate() - 1);
        attempts++;
      }

      logger.warn(`No debates found after ${MAX_ATTEMPTS} attempts`, {
        startDate: targetDate,
        house
      });
      return [];

    } catch (error) {
      logger.error('Failed to get debates list:', {
        error: error.message,
        stack: error.stack,
        date,
        house
      });
      return [];
    }
  }

  static async processHouseDebates(date, house) {
    try {
      const debates = [];
      const sections = await this.getAvailableSections(date, house);

      // Process each section
      for (const section of sections) {
        const sectionData = await this.fetchSectionTrees({
          format: 'json',
          house,
          date,
          section
        });

        if (!Array.isArray(sectionData)) {
          logger.warn('Invalid section data:', { section, house, date });
          continue;
        }

        // Process section tree items recursively
        const processItems = async (items, parentTitle = '') => {
          if (!Array.isArray(items)) return;

          for (const item of items) {
            if (item.ParentId === null) {
              if (item.SectionTreeItems) {
                await processItems(item.SectionTreeItems, item.Title);
              }
              continue;
            }

            if (item.ExternalId) {
              try {
                const debateData = await this.fetchDebate(item.ExternalId);
                const speakersData = await this.fetchSpeakers(item.ExternalId);
                
                debates.push({
                  ...item,
                  parentTitle,
                  debateDate: date,
                  house,
                  section,
                  debate: debateData,
                  speakers: speakersData
                });
                
                logger.debug('Processed debate:', { 
                  externalId: item.ExternalId, 
                  title: item.Title,
                  section 
                });
              } catch (error) {
                logger.error('Failed to fetch debate details:', {
                  error: error.message,
                  stack: error.stack,
                  externalId: item.ExternalId,
                  section
                });
              }
            }

            if (item.SectionTreeItems) {
              await processItems(item.SectionTreeItems, item.Title);
            }
          }
        };

        await processItems(sectionData);
      }
      
      return debates;
    } catch (error) {
      logger.error('Failed to process house debates:', {
        error: error.message,
        stack: error.stack,
        date,
        house
      });
      return [];
    }
  }

  static async getDebateDetails(debateSectionExtId) {
    try {
      
      const [debate, speakers] = await Promise.all([
        this.fetchDebate(debateSectionExtId),
        this.fetchSpeakers(debateSectionExtId)
      ]);

      return {
        debate,
        speakers,
      };
    } catch (error) {
      logger.error('Failed to get debate details:', {
        error: error.message,
        stack: error.stack,
        debateSectionExtId,
        details: error.details || {}
      });
      throw error;
    }
  }

  static async searchMembers(params = {}, skip = 0) {
    const url = `${HANSARD_API_BASE}/search/members.json?` +
      new URLSearchParams({
        ...params,
        skip,
        take: 50 // Fetch 50 results at a time
      });

    return this.fetchWithErrorHandling(url);
  }

  static async fetchDivisionsList(debateSectionExtId) {
    const url = `${HANSARD_API_BASE}/debates/divisions/${debateSectionExtId}.json`;
    return this.fetchWithErrorHandling(url);
  }

  static async fetchDivisionDetails(divisionExtId, isEvel = false) {
    const url = `${HANSARD_API_BASE}/debates/division/${divisionExtId}.json?` +
      new URLSearchParams({ isEvel: isEvel });
    return this.fetchWithErrorHandling(url);
  }
}