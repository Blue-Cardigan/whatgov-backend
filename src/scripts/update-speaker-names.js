import { readFile } from 'fs/promises';
import { SupabaseService, supabase } from '../services/supabase.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

async function updateSpeakerNames() {
  try {
    // Read and parse the JSON file
    const rawData = await readFile('data/all_former_members.json', 'utf8');
    const formerMembers = JSON.parse(rawData);
    
    // Get all former speaker data from the database
    const { data: speakersData, error } = await supabase
      .from('speakers')
      .select('id, name, constituency')
      .eq('is_current', false)
      .not('constituency', 'is', null);
      
    if (error) throw error;

    // Helper function to normalize strings for comparison
    const normalize = (str) => str?.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Create updates array
    const updates = [];
    
    speakersData.forEach(speaker => {
      const normalizedSpeakerConstituency = normalize(speaker.constituency);
      
      const matchingMember = formerMembers.find(member => {
        const normalizedMemberConstituency = normalize(member.constituency);
        return normalizedMemberConstituency === normalizedSpeakerConstituency;
      });

      if (matchingMember && normalize(speaker.name) !== normalize(matchingMember.name)) {
        updates.push({
          id: speaker.id,
          old_name: speaker.name,
          new_name: matchingMember.name,
          constituency: speaker.constituency,
          normalized_constituency: normalizedSpeakerConstituency
        });
      }
    });

    logger.info(`Found ${updates.length} former member names to update`);

    // Perform the updates
    for (const update of updates) {
      logger.info('Updating former speaker:', update);
      
      const { error: updateError } = await supabase
        .from('speakers')
        .update({ name: update.new_name })
        .eq('id', update.id);

      if (updateError) {
        logger.error('Error updating former speaker:', { update, error: updateError });
      }
    }

    logger.info('Former member name updates completed');
    return updates;
    
  } catch (error) {
    logger.error('Error updating former speaker names:', error);
    throw error;
  }
}

// Execute if running directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updateSpeakerNames()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { updateSpeakerNames }; 