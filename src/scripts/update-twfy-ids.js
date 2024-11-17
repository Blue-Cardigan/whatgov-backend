#!/usr/bin/env node

import { SupabaseService } from '../services/supabase.js';
import logger from '../utils/logger.js';

const PEER_TITLES = [
  'Lord', 'Lady', 'Baroness', 'Baron', 'Earl', 'Countess', 
  'Viscount', 'Viscountess', 'Duke', 'Duchess', 'Archbishop', 'Bishop',
  'The Lord', 'The Lady', 'The Earl'
];

function isPeer(displayAs) {
  const titleRegex = new RegExp(`^(${PEER_TITLES.join('|')})\\s`, 'i');
  return titleRegex.test(displayAs);
}

async function formatTwfyUrl(displayAs) {
  // Check if it's a peer first
  if (isPeer(displayAs)) {
    // Remove 'The' and 'Rt Hon'
    let cleanName = displayAs
      .replace(/^The\s+/i, '')
      .replace(/^Rt Hon\s+/i, '')
      .toLowerCase();

    // Special cases for different peer types
    if (cleanName.startsWith('lord bishop of ')) {
      // For Bishops, use "bishop_of_X" format
      cleanName = cleanName.replace('lord bishop of ', 'bishop_of_');
    } else if (cleanName.startsWith('lord archbishop of ')) {
      // For Archbishops, use "archbishop_of_X" format
      cleanName = cleanName.replace('lord archbishop of ', 'archbishop_of_');
    } else if (cleanName.includes(' of ')) {
      // For other peers with "of", like "Duke of Norfolk"
      cleanName = cleanName.replace(/^(earl|duke|baron|baroness|viscount|viscountess)\s+of\s+/i, '$1_of_');
    } else if (cleanName.includes(' and ')) {
      // For bishops with multiple locations like "St Edmundsbury and Ipswich"
      cleanName = cleanName.replace(/\s+and\s+/g, '_and_');
    } else {
      // For simple peer names like "Lord Carrington" or "Earl Russell"
      cleanName = cleanName.replace(/^(lord|earl|viscount)\s+/i, '$1_');
    }

    // Replace remaining spaces with underscores
    cleanName = cleanName.replace(/\s+/g, '_');
    
    // Special handling for 'St' abbreviation
    cleanName = cleanName.replace(/st_/g, 'st-');

    return `https://www.theyworkforyou.com/peer/${cleanName}`;
  }

  // For MPs - keep existing logic
  let cleanName = displayAs
    .replace(/^The\s+/i, '')
    .replace(/^(Sir|Dame|Dr|Mr|Mrs|Ms|Miss|Rt Hon)\s+/i, '')
    .replace(/\s+/g, '_')
    .toLowerCase();

  return `https://www.theyworkforyou.com/mp/${cleanName}`;
}

async function getRedirectUrl(url) {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (response.status === 301 || response.status === 302) {
      return response.headers.get('location');
    }

    return null;
  } catch (error) {
    logger.error(`Failed to get redirect for URL ${url}:`, error);
    return null;
  }
}

async function extractTwfyId(redirectUrl, isPeerUrl) {
  if (!redirectUrl) return null;
  
  // Different patterns for MPs and Peers
  const pattern = isPeerUrl ? 
    /\/peer\/(\d+)\// :  // Peer pattern
    /\/mp\/(\d+)\//;     // MP pattern
    
  const match = redirectUrl.match(pattern);
  return match ? match[1] : null;
}

async function updateMemberTwfyDetails() {
  try {
    const { data: members, error } = await SupabaseService.getMembersWithoutTwfyId();
    
    if (error) throw error;
    
    logger.info(`Found ${members.length} members without TWFY IDs`);
    
    for (const member of members) {
      try {
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const isPeerMember = isPeer(member.display_as);
        const initialUrl = await formatTwfyUrl(member.display_as);
        const redirectUrl = await getRedirectUrl(initialUrl);
        const twfyId = await extractTwfyId(redirectUrl, isPeerMember);
        
        if (twfyId && redirectUrl) {
          await SupabaseService.updateMemberTwfy({
            memberId: member.member_id,
            twfyId,
            twfyUrl: redirectUrl,
            memberType: isPeerMember ? 'peer' : 'mp'
          });
          
          logger.info(`Updated ${isPeerMember ? 'peer' : 'mp'} ${member.display_as}:`, {
            twfyId,
            twfyUrl: redirectUrl
          });
        } else {
          logger.warn(`Could not find TWFY details for ${member.display_as}`);
        }
        
      } catch (error) {
        logger.error(`Failed to process member ${member.display_as}:`, error);
        continue;
      }
    }
    
    logger.info('TWFY update completed');
    
  } catch (error) {
    logger.error('Failed to update TWFY details:', error);
    throw error;
  }
}

async function main() {
  try {
    await updateMemberTwfyDetails();
    process.exit(0);
  } catch (error) {
    logger.error('Script failed:', error);
    process.exit(1);
  }
}

main(); 