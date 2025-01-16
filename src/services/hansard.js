import logger from '../utils/logger.js';
import { SupabaseService } from './supabase.js';
import { getDebateType, validateDebateContent } from '../utils/transforms.js';

const HANSARD_API_BASE = 'https://hansard-api.parliament.uk';

const PARTY_MAPPINGS = {
  'LAB': 'Labour',
  'Lab': 'Labour',
  'Lab/Co-op': 'Labour',
  'LD': 'Liberal Democrats',
  'CON': 'Conservative',
  'Con': 'Conservative',
  'CB': 'Crossbench',
  'SNP': 'SNP (Scottish National Party)',
};

export class HansardService {
  static debateCache = new Map();
  static dateCache = {
    timestamp: 0,
    lastProcessedDate: null,
    latestSittingDate: null,
    sittingDates: new Map()
  };
  static memberCache = new Map();

  static async fetchWithErrorHandling(url, retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        if ((response.status === 429 || response.status === 400) && retryCount < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
          return this.fetchWithErrorHandling(url, retryCount + 1);
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

  // API Methods
  static async fetchDebate(debateId) {
    if (this.debateCache.has(debateId)) {
      return this.debateCache.get(debateId);
    }

    const url = `${HANSARD_API_BASE}/debates/debate/${debateId}.json`;
    const data = await this.fetchWithErrorHandling(url);
    this.debateCache.set(debateId, data);
    return data;
  }

  // Business Logic Methods
  static async getLatestDebates(options = {}) {
    try {
      const { specificDate, specificDebateId, aiProcess } = options;

      // Refresh cache if older than 30 minutes
      if (Date.now() - this.dateCache.timestamp > 1800000) {
        const latestSittingDate = await this.getLastSittingDate();
        this.dateCache = {
          timestamp: Date.now(),
          latestSittingDate,
          sittingDates: this.dateCache.sittingDates // Preserve sitting dates cache
        };
      }

      logger.debug('Getting latest debates with options:', {
        specificDate,
        specificDebateId,
        aiProcess: aiProcess || 'all',
        latestSittingDate: this.dateCache.latestSittingDate
      });

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

      // Use provided date or latest sitting date
      const dateToProcess = specificDate || this.dateCache.latestSittingDate;
      if (!dateToProcess) {
        logger.warn('No valid date available for processing');
        return [];
      }

      logger.info(`Processing debates for date: ${dateToProcess}`);

      // Get debates from both houses
      const [commonsDebates, lordsDebates] = await Promise.all([
        this.getHouseDebates(dateToProcess, 'Commons'),
        this.getHouseDebates(dateToProcess, 'Lords')
      ]);

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

      // Filter out debates that don't have required fields
      const validDebates = processedDebates.filter(debate => 
        debate?.ExternalId && 
        debate?.Title
      );

      logger.info(`Valid debates after filtering: ${validDebates.length}`);
      
      return validDebates;

    } catch (error) {
      logger.error('Failed to fetch latest debates:', {
        error: error.message,
        stack: error.stack,
        options
      });
      throw error;
    }
  }

  static async getHouseDebates(date, house) {
    try {
      // First get available sections for the date
      const url = `${HANSARD_API_BASE}/overview/sectionsforday.json?` +
        new URLSearchParams({ date, house });
      
      logger.debug(`Fetching sections for ${house} on ${date}`, { url });
      
      const sections = await this.fetchWithErrorHandling(url);
      
      if (!Array.isArray(sections)) {
        logger.warn(`Invalid sections response for ${house}`, {
          date,
          response: sections
        });
        return [];
      }

      logger.info(`Found ${sections.length} sections for ${house} on ${date}`);

      // Process sections in parallel batches
      const batchSize = 5;
      const debates = [];
      
      for (let i = 0; i < sections.length; i += batchSize) {
        const batch = sections.slice(i, i + batchSize);
        const batchPromises = batch.map(async (section) => {
          try {
            const sectionUrl = `${HANSARD_API_BASE}/overview/sectiontrees.json?` +
              new URLSearchParams({
                house,
                date,
                section
              });
              
            logger.debug(`Fetching section tree`, { section, url: sectionUrl });
            
            const sectionData = await this.fetchWithErrorHandling(sectionUrl);
            
            if (!Array.isArray(sectionData)) {
              logger.warn('Invalid section data:', { section, house, date, sectionData });
              return [];
            }
            
            return this.processItems(sectionData, { date, house, section });
          } catch (error) {
            logger.error(`Failed to fetch section tree`, {
              error: error.message,
              section,
              house,
              date
            });
            return [];
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        debates.push(...batchResults.flat());
        
        // Add small delay between batches
        if (i + batchSize < sections.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      logger.info(`Fetched ${debates.length} ${house} debates for ${date}`);
      return debates;
      
    } catch (error) {
      logger.error(`Failed to fetch ${house} debates:`, {
        error: error.message,
        stack: error.stack,
        date,
        house
      });
      return [];
    }
  }

  static async getDebateDetails(debateId) {
    try {
      const details = await this.fetchDebate(debateId);
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

  static async getLastSittingDate(house) {
    try {
      const now = Date.now();
      
      // Check cache first
      if (house) {
        const cached = this.dateCache.sittingDates.get(house);
        if (cached && (now - cached.timestamp < 30 * 60 * 1000)) {
          return cached.date;
        }
      } else {
        // For no specific house, check if we have a cached latest date
        const cached = this.dateCache.sittingDates.get('latest');
        if (cached && (now - cached.timestamp < 30 * 60 * 1000)) {
          return cached.date;
        }
      }

      // If specific house requested, fetch just that one
      if (house) {
        const url = `${HANSARD_API_BASE}/overview/lastsittingdate.json?` +
          new URLSearchParams({ house });
        
        const response = await this.fetchWithErrorHandling(url);
        const date = response.replace(/"/g, '').trim();
        
        this.dateCache.sittingDates.set(house, {
          date,
          timestamp: now
        });
        
        return date;
      }

      // If no house specified, always fetch both
      const [commonsDate, lordsDate] = await Promise.all([
        this.getLastSittingDate('Commons'),
        this.getLastSittingDate('Lords')
      ]);

      // Compare dates and return the most recent
      const mostRecent = new Date(commonsDate) > new Date(lordsDate) 
        ? commonsDate 
        : lordsDate;

      // Cache the latest date
      this.dateCache.sittingDates.set('latest', {
        date: mostRecent,
        timestamp: now
      });

      logger.info('Fetched latest sitting dates:', {
        commons: commonsDate,
        lords: lordsDate,
        mostRecent
      });

      return mostRecent;

    } catch (error) {
      logger.error('Failed to fetch last sitting date:', {
        error: error.message,
        stack: error.stack,
        house
      });
      throw error;
    }
  }

  static getMemberDetails(item) {
    try {
      // Return early if no AttributedTo
      if (!item.AttributedTo) {
        logger.debug('No AttributedTo field for member:', { memberId: item.MemberId });
        return null;
      }
      
      // Handle ministerial format
      if (item.AttributedTo.startsWith('The ')) {
        const match = item.AttributedTo.match(/^The ([^(]+)/);
        if (match) {
          return {
            MemberId: item.MemberId,
            Name: null,
            Role: match[1].trim(),
            firstSeen: item.Timecode
          };
        }
      }
      else {
        // Match pattern: "Name (Constituency) (Party)"
        const fullMatch = item.AttributedTo.match(/^([^(]+)\s*\(([^)]+)\)\s*\(([^)]+)\)/);
        if (fullMatch) {
          const rawParty = fullMatch[3].trim();
          return {
            MemberId: item.MemberId,
            Name: fullMatch[1].trim(),
            Constituency: fullMatch[2].trim(),
            Party: PARTY_MAPPINGS[rawParty] || rawParty,
            firstSeen: item.Timecode
          };
        }

        // Match pattern: "Name (Party)" - typically used for Lords
        const simpleMatch = item.AttributedTo.match(/^([^(]+)\s*\(([^)]+)\)/);
        if (simpleMatch) {
          const rawParty = simpleMatch[2].trim();
          return {
            MemberId: item.MemberId,
            Name: simpleMatch[1].trim(),
            Party: PARTY_MAPPINGS[rawParty] || rawParty,
            firstSeen: item.Timecode
          };
        }

        // Handle basic name-only format
        return {
          MemberId: item.MemberId,
          Name: item.AttributedTo.trim(),
          firstSeen: item.Timecode
        };
      }
    } catch (error) {
      logger.error('Failed to extract member details:', {
        error: error.message,
        itemId: item.ItemId,
        memberId: item.MemberId,
        attributedTo: item.AttributedTo
      });
      return null;
    }
  }

  static async processItems(items, context = {}) {
    if (!Array.isArray(items)) return [];
    const debateMemberCache = new Map();
    
    // Add a Set to track member IDs that need to be fetched from Supabase
    const membersToFetch = new Set();

    const promises = items.map(async (item) => {
      if (item.ExternalId) {
        try {
          // Check cache first
          if (this.debateCache.has(item.ExternalId)) {
            const cached = this.debateCache.get(item.ExternalId);
            return cached;
          }

          // Fetch debate data
          const debateData = await this.fetchDebate(item.ExternalId);
          
          // First pass: Get member details and collect IDs that need fetching
          const simplifiedItems = debateData.Items?.map(item => {
            let memberDetails = item.MemberId ? this.getMemberDetails(item) : null;
            
            // If we have a member ID but no name/details, add to fetch list
            if (item.MemberId && (!memberDetails?.Name && !memberDetails?.Role)) {
              membersToFetch.add(item.MemberId);
            }
            
            // Use cached details if available
            if (item.MemberId && (!memberDetails || !memberDetails.Name) && debateMemberCache.has(item.MemberId)) {
              memberDetails = debateMemberCache.get(item.MemberId);
            }
            
            // Cache valid member details
            if (memberDetails?.Name) {
              debateMemberCache.set(item.MemberId, memberDetails);
            }

            return {
              memberId: item.MemberId,
              name: memberDetails?.Name,
              title: memberDetails?.Role,
              constituency: memberDetails?.Constituency,
              party: memberDetails?.Party,
              value: item.Value ? item.Value.replace(/<[^>]+>/g, '').trim() : null
            };
          });

          // If we have members to fetch, get them from Supabase
          if (membersToFetch.size > 0) {
            const { data: supabaseMembers } = await SupabaseService.getMemberDetails([...membersToFetch]);
            // Update simplified items with Supabase data
            if (supabaseMembers?.length) {
              const supabaseMemberMap = new Map(
                supabaseMembers.map(member => [
                  member.member_id, 
                  {
                    ...member,
                    party: PARTY_MAPPINGS[member.party] || member.party // Normalize party names from Supabase too
                  }
                ])
              );

              simplifiedItems.forEach(item => {
                if (item.memberId && !item.name && !item.title) {
                  const supabaseMember = supabaseMemberMap.get(item.memberId);
                  if (supabaseMember) {
                    item.name = supabaseMember.display_as;
                    item.constituency = supabaseMember.constituency;
                    item.party = supabaseMember.party;
                    item.role = supabaseMember.department || '';

                    // Cache the member details for future use
                    debateMemberCache.set(item.memberId, {
                      MemberId: item.memberId,
                      Name: supabaseMember.display_as,
                      Constituency: supabaseMember.constituency,
                      Party: supabaseMember.party,
                      Role: supabaseMember.department || ''
                    });
                  }
                }
              });
            }
          }

          // Continue with existing filtering
          const filteredItems = simplifiedItems
            .filter(Boolean)
            .filter(item => {
              if (!item.memberId && !item.name && !item.title) {
                const timeRegex = /^\d{2}:\d{2}:\d{2}$/;
                return !timeRegex.test(item.value);
              }
              return true;
            });

          const result = {
            ExternalId: item.ExternalId,
            Title: item.Title,
            debateDate: context.date,
            house: context.house,
            section: context.section,
            Items: filteredItems,
            Overview: debateData.Overview
          };

          this.debateCache.set(item.ExternalId, result);
          return result;

        } catch (error) {
          logger.error('Failed to fetch debate details:', {
            error: error.message,
            externalId: item.ExternalId
          });
          return null;
        }
      }
      
      if (item.SectionTreeItems) {
        return this.processItems(item.SectionTreeItems, context);
      }
      
      return null;
    });

    const results = await Promise.all(promises);
    return results.flat().filter(Boolean);
  }

  // Add method to get all cached members
  static getAllMembers() {
    return Array.from(this.memberCache.values());
  }

  static async getDebateIds(date, house) {
    try {
      // Get debates from both houses if no specific house is specified
      const [commonsDebates, lordsDebates] = await Promise.all([
        this.getHouseDebates(date, 'Commons'),
        this.getHouseDebates(date, 'Lords')
      ]);

      // Combine and extract debate IDs
      const allDebates = [...commonsDebates, ...lordsDebates];
      const debateIds = allDebates
        .filter(debate => debate?.ExternalId)
        .map(debate => debate.ExternalId);

      logger.debug(`Found ${debateIds.length} debate IDs for date ${date}`);
      return debateIds;
    } catch (error) {
      logger.error('Failed to get debate IDs:', {
        error: error.message,
        stack: error.stack,
        date,
        house
      });
      throw error;
    }
  }
}