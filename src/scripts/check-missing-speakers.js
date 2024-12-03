import { readFile } from 'fs/promises';
import { SupabaseService, supabase } from '../services/supabase.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

async function findMissingSpeakers() {
  try {
    // Read and parse the JSON file
    const rawData = await readFile('data/all_current_members.json', 'utf8');
    const currentMembers = JSON.parse(rawData);
    
    // Get all speaker data from the database
    const { data: speakersData, error } = await supabase
      .from('members')
      .select('display_as, party, constituency')
      .not('display_as', 'is', null);
      
    if (error) throw error;
    
    // Helper function to normalize strings for comparison
    const normalize = (str) => str?.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Helper function to find potential matches
    const findPotentialMatches = (member, speakers) => {
      const normalizedMemberName = normalize(member.name);
      
      return speakers.filter(speaker => {
        // Check for name variations
        const normalizedSpeakerName = normalize(speaker.display_as);
        const nameMatch = 
          normalizedSpeakerName.includes(normalizedMemberName) ||
          normalizedMemberName.includes(normalizedSpeakerName);
          
        // Check party and constituency if available
        const partyMatch = normalize(speaker.party) === normalize(member.party);
        const constituencyMatch = normalize(speaker.constituency) === normalize(member.constituency);
        
        // Return true if name matches and at least one other field matches
        return nameMatch && (partyMatch || constituencyMatch);
      });
    };

    const results = currentMembers.map(member => {
      // First check for exact matches
      const exactMatch = speakersData.find(s => normalize(s.display_as) === normalize(member.name));
      
      if (exactMatch) return null;
      
      // If no exact match, look for potential matches
      const potentialMatches = findPotentialMatches(member, speakersData);
      
      return {
        member,
        potentialMatches: potentialMatches.map(match => ({
          name: match.display_as,
          party: match.party,
          constituency: match.constituency
        }))
      };
    }).filter(Boolean); // Remove null entries (exact matches)
    
    // Log results
    logger.info(`Found ${results.length} members without exact matches`);
    
    results.forEach(({ member, potentialMatches }) => {
      if (potentialMatches.length > 0) {
        logger.info('Member with potential matches:', {
          member: {
            name: member.name,
            party: member.party,
            constituency: member.constituency
          },
          potentialMatches
        });
      } else {
        logger.info('Member with no matches:', {
          name: member.name,
          party: member.party,
          constituency: member.constituency
        });
      }
    });
    
    return results;
    
  } catch (error) {
    logger.error('Error checking missing speakers:', error);
    throw error;
  }
}

// Execute if running directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  findMissingSpeakers()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { findMissingSpeakers }; 