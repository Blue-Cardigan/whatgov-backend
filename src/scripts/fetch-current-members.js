import fs from 'fs/promises';
import path from 'path';
import { HansardAPI } from '../services/hansard-api.js';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';

async function fetchAllCurrentMembers() {
  const members = [];
  let skip = 0;
  const batchSize = 50; // Maximum allowed by API
  
  try {
    while (true) {
      const response = await HansardAPI.searchMembers({
        includeCurrent: true,
        includeFormer: false,
        take: batchSize,
      }, skip);

      if (!response.Results || response.Results.length === 0) {
        break;
      }

      // Extract relevant information from each member
      const processedMembers = response.Results.map(member => ({
        memberId: member.MemberId,
        name: member.DisplayAs,
        constituency: member.MemberFrom,
        party: member.Party,
        house: member.House,
        gender: member.Gender,
        startDate: member.HouseStartDate
      }));

      members.push(...processedMembers);
      
      logger.info(`Fetched ${processedMembers.length} members (offset: ${skip})`);
      
      if (members.length >= response.TotalResults) {
        break;
      }
      
      skip += batchSize;
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Sort members by house and name
    members.sort((a, b) => {
      if (a.house !== b.house) {
        return a.house.localeCompare(b.house);
      }
      return a.name.localeCompare(b.name);
    });

    // Write to file
    const outputPath = path.join(process.cwd(), 'data', 'all_current_members.json');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(members, null, 2));

    logger.info(`Successfully saved ${members.length} members to all_current_members.json`);
    return members;

  } catch (error) {
    logger.error('Failed to fetch members:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Run the script if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchAllCurrentMembers()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { fetchAllCurrentMembers }; 