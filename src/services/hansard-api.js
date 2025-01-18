import logger from '../utils/logger.js';

export const HANSARD_API_BASE = 'https://hansard-api.parliament.uk';

/**
 * Main flow to fetch latest debate data:
 * 1. getDebatesList() is the main entry point
 *    - Calls getLastSittingDate() if no date provided
 *    - Fetches debates for both Commons and Lords in parallel
 *    - Will try up to 5 previous dates if no debates found
 * 
 * 2. For each house:
 *    - Gets available sections via getAvailableSections()
 *    - Processes sections in batches of 5 via processHouseDebates()
 *    - For each section, fetches section trees via fetchSectionTrees()
 * 
 * 3. For each debate found:
 *    - Fetches full debate data via fetchDebate()
 *    - Fetches speakers list via fetchSpeakers()
 * 
 * Potential redundant API calls:
 * - In processItems(): Debate data is fetched twice if getDebateDetails() 
 *   is called separately for the same debate
 * - In getLastSittingDate(): Both Commons and Lords dates are always fetched 
 *   when no house is specified, even if only one is needed
 * - In getDebatesList(): Debates for both houses are always fetched initially,
 *   even when only one house is requested
 */

export class HansardAPI {
  static async fetchWithErrorHandling(url, retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second

    try {
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
    const url = `${HANSARD_API_BASE}/overview/sectiontrees.json?` + 
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
      // Only fetch the requested house
      if (house) {
        const url = `${HANSARD_API_BASE}/overview/lastsittingdate.json?` +
          new URLSearchParams({ house });
        const response = await this.fetchWithErrorHandling(url);
        return response.replace(/"/g, '').trim();
      }

      // If no house specified, fetch Commons first and only fetch Lords if needed
      const commonsDate = await this.getLastSittingDate('Commons');
      const commonsDateTime = new Date(commonsDate);
      
      // Only fetch Lords if Commons date is old (e.g., more than 2 days old)
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      
      if (commonsDateTime < twoDaysAgo) {
        const lordsDate = await this.getLastSittingDate('Lords');
        return new Date(commonsDate) > new Date(lordsDate) ? commonsDate : lordsDate;
      }
      
      return commonsDate;
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
      const targetDate = date || await this.getLastSittingDate(house); // Only fetch date for requested house
      let currentDate = new Date(targetDate);
      let attempts = 0;
      const MAX_ATTEMPTS = 5;

      while (attempts < MAX_ATTEMPTS) {
        const formattedDate = currentDate.toISOString().split('T')[0];

        // Only fetch debates for the requested house
        const debates = await this.processHouseDebates(formattedDate, house);

        if (debates.length > 0) {
          return debates;
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
      const sections = await this.getAvailableSections(date, house);
      
      // Process sections in parallel batches
      const batchSize = 5; // Adjust based on API limits
      const debates = [];
      
      for (let i = 0; i < sections.length; i += batchSize) {
        const batch = sections.slice(i, i + batchSize);
        const batchPromises = batch.map(async (section) => {
          const sectionData = await this.fetchSectionTrees({
            house,
            date,
            section
          });
          if (!Array.isArray(sectionData)) {
            logger.warn('Invalid section data:', { section, house, date });
            return [];
          }
          
          return this.processItems(sectionData, '', { date, house, section });
        });
        
        const batchResults = await Promise.all(batchPromises);
        debates.push(...batchResults.flat());
        
        // Add small delay between batches to avoid rate limiting
        if (i + batchSize < sections.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      return debates;
    } catch (error) {
      logger.error('Failed to process house debates:', {
        error: error.message,
        date,
        house
      });
      return [];
    }
  }

  // Cache for debate details to prevent duplicate fetches
  static debateCache = new Map();

  static async processItems(items, context = {}) {
    if (!Array.isArray(items)) return [];

    let isFirstDebate = true; // Flag to track first debate

    const promises = items.map(async (item) => {
      if (item.ExternalId) {
        try {
          // Check cache first
          if (this.debateCache.has(item.ExternalId)) {
            return this.debateCache.get(item.ExternalId);
          }

          // Make API calls in parallel
          const [debateData, speakersData] = await Promise.all([
            HansardAPI.fetchDebate(item.ExternalId),
            HansardAPI.fetchSpeakers(item.ExternalId)
          ]);
          
          const result = {
            ExternalId: item.ExternalId,
            Title: item.Title,
            debateDate: context.date,
            house: context.house,
            section: context.section,
            Items: debateData.Items || [],
            Overview: debateData.Overview,
            speakers: speakersData,
            debate: debateData
          };

          // Only log detailed structure for first debate
          if (isFirstDebate) {
            logger.info('First debate structure:', {
              structure: {
                keys: Object.keys(result),
                itemsLength: result.Items.length,
                firstItem: result.Items[0] ? {
                  keys: Object.keys(result.Items[0]),
                  sample: JSON.stringify(result.Items[0]).slice(0, 200) + '...'
                } : null,
                speakersLength: result.speakers?.length,
                firstSpeaker: result.speakers?.[0] ? {
                  keys: Object.keys(result.speakers[0]),
                  sample: JSON.stringify(result.speakers[0]).slice(0, 200) + '...'
                } : null,
                overviewKeys: result.Overview ? Object.keys(result.Overview) : null
              }
            });
            isFirstDebate = false;
          }

          // Cache the result
          this.debateCache.set(item.ExternalId, result);
          
          return result;
        } catch (error) {
          logger.error('Failed to fetch debate details:', {
            error: error.message,
            externalId: item.ExternalId,
            itemStructure: Object.keys(item)
          });
          return null;
        }
      }
      
      if (item.SectionTreeItems) {
        return HansardAPI.processItems(item.SectionTreeItems, context);
      }
      
      return null;
    });

    // Wait for all promises to resolve
    const results = await Promise.all(promises);
    return results.flat().filter(Boolean);
  }

  static async getDebateDetails(debateSectionExtId) {
    try {
      // Check cache first
      if (this.debateCache.has(debateSectionExtId)) {
        const cached = this.debateCache.get(debateSectionExtId);
        return {
          ExternalId: cached.ExternalId,
          Title: cached.Title,
          Items: cached.Items,
          Overview: cached.Overview,
          speakers: cached.speakers
        };
      }

      // If not in cache, fetch and cache the result
      const [debateData, speakers] = await Promise.all([
        this.fetchDebate(debateSectionExtId),
        this.fetchSpeakers(debateSectionExtId)
      ]);

      const result = {
        ExternalId: debateSectionExtId,
        Title: debateData.Title,
        Items: debateData.Items,
        Overview: debateData.Overview,
        speakers
      };

      this.debateCache.set(debateSectionExtId, result);
      return result;
    } catch (error) {
      logger.error('Failed to get debate details:', {
        error: error.message,
        debateSectionExtId
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