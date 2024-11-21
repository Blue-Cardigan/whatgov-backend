#!/usr/bin/env node

import { SupabaseService } from '../services/supabase.js';
import { HansardAPI } from '../services/hansard-api.js';
import logger from '../utils/logger.js';

async function updateDebateSpeakers() {
  try {
    // Get all debates with title field included
    const { data: debates, error: debatesError } = await SupabaseService.getDebates();
    
    if (debatesError) throw debatesError;
    
    logger.info(`Found ${debates.length} debates to process`);
    
    for (const debate of debates) {
      try {
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Fetch debate details from Hansard API
        const { debate: debateDetails } = await HansardAPI.getDebateDetails(debate.ext_id);
        
        if (!debateDetails?.Items) {
          logger.warn(`No items found for debate ${debate.ext_id}`);
          continue;
        }
        
        // Extract unique member IDs from contributions
        const memberIds = [...new Set(
          debateDetails.Items
            .filter(item => item?.ItemType === 'Contribution' && item?.MemberId)
            .map(item => item.MemberId)
        )];
        
        if (!memberIds.length) {
          logger.debug(`No member contributions found in debate ${debate.ext_id}`);
          continue;
        }
        
        // Fetch member details from Supabase
        const { data: members, error: membersError } = await SupabaseService.getMemberDetails(memberIds);
        
        if (membersError) {
          logger.error(`Failed to fetch member details for debate ${debate.ext_id}:`, membersError);
          continue;
        }
        
        // Create speakers array with unique display names
        const speakers = [...new Set(
          members
            .filter(member => member.display_as)
            .map(member => member.display_as)
        )];
        
        // Update only speakers-related fields
        const { error: updateError } = await SupabaseService.updateDebateSpeakers({
          ext_id: debate.ext_id,
          speakers,
          speaker_count: speakers.length
        });
        
        if (updateError) {
          logger.error(`Failed to update speakers for debate ${debate.ext_id}:`, updateError);
          continue;
        }
        
        logger.info(`Updated speakers for debate ${debate.ext_id}:`, {
          speakerCount: speakers.length
        });
        
      } catch (error) {
        logger.error(`Failed to process debate ${debate.ext_id}:`, error);
        continue;
      }
    }
    
    logger.info('Speaker update completed');
    
  } catch (error) {
    logger.error('Failed to update debate speakers:', error);
    throw error;
  }
}

async function main() {
  try {
    await updateDebateSpeakers();
    process.exit(0);
  } catch (error) {
    logger.error('Script failed:', error);
    process.exit(1);
  }
}

main(); 