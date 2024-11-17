#!/usr/bin/env node

import { MemberSync } from '../services/member-sync.js';
import logger from '../utils/logger.js';

async function main() {
  try {
    logger.info('Starting member sync...');
    const totalProcessed = await MemberSync.syncAllMembers();
    logger.info('Member sync completed successfully', { totalProcessed });
    process.exit(0);
  } catch (error) {
    logger.error('Member sync failed:', error);
    process.exit(1);
  }
}

main();