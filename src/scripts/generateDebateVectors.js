#!/usr/bin/env node

import { SupabaseService } from '../services/supabase.js';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import logger from '../utils/logger.js';

async function formatDebateForVector(debate) {
  // Format speakers from ai_topics
  const speakers = debate.ai_topics.flatMap(topic => 
    topic.speakers.map(s => ({
      name: s.name,
      party: s.party,
      constituency: s.constituency,
      topics: topic.name,
      subtopics: s.subtopics
    }))
  );

  // Format key points with context
  const keyPoints = debate.ai_key_points.map(kp => {
    const supportText = kp.support?.length ? 
      `\nSupported by: ${kp.support.map(s => `${s.name} (${s.party}, ${s.constituency})`).join(', ')}` : '';
    const oppositionText = kp.opposition?.length ? 
      `\nOpposed by: ${kp.opposition.map(s => `${s.name} (${s.party}, ${s.constituency})`).join(', ')}` : '';
    const keywordsText = kp.keywords?.length ? 
      `\nKeywords: ${kp.keywords.join(', ')}` : '';

    const speakerInfo = kp.speaker ? 
      `${kp.speaker.name} (${kp.speaker.party}, ${kp.speaker.constituency}):` :
      'Speaker Unknown:';

    return `${speakerInfo}
    ${kp.point}
    ${kp.context ? `Context: ${kp.context}` : ''}${supportText}${oppositionText}${keywordsText}`;
  });

  // Format topics with null checks
  const topics = debate.ai_topics?.map(topic => ({
    name: topic.name,
    subtopics: [...new Set(topic.speakers?.flatMap(s => s.subtopics || []) || [])]
  })) || [];

  return `Title: ${debate.title}
Date: ${debate.date} (${debate.day_of_week || ''})
Type: ${debate.type}
Location: ${debate.location}
House: ${debate.house}

Speakers:
${speakers.map(s => `- ${s.name} (${s.party}, ${s.constituency})\n  Topics: ${s.topics}\n  Subtopics: ${s.subtopics.join(', ')}`).join('\n')}

Tone: ${debate.ai_tone || 'Not specified'}

Summary:
${debate.ai_summary || 'No summary available'}

Topics:
${topics.map(t => `${t.name}:\n  ${t.subtopics.join(', ')}`).join('\n') || 'No topics available'}

Key Points:
${keyPoints.join('\n\n')}`;
}

function getMondayDateString(date) {
  const dayOfWeek = date.getUTCDay();
  const mondayOffset = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
  const mondayDate = new Date(date);
  mondayDate.setUTCDate(date.getUTCDate() + mondayOffset);
  return mondayDate.toISOString().split('T')[0];
}

async function generateVectorForDebate(extId) {
  try {
    // Add method to SupabaseService to fetch specific debate
    const { data: debates, error } = await SupabaseService.getDebateByExtId(extId);

    if (error) {
      logger.error('Error fetching debate:', error);
      throw error;
    }

    if (!debates || debates.length === 0) {
      logger.error(`No debate found with ext_id: ${extId}`);
      return 0;
    }

    const debate = debates[0];
    const debateDate = new Date(debate.date);
    const mondayDateString = getMondayDateString(debateDate);

    // Create vectors directory with the date of the Monday
    const vectorsDir = join(process.cwd(), 'vectors', mondayDateString);
    await mkdir(vectorsDir, { recursive: true });

    try {
      const vectorText = await formatDebateForVector(debate);
      const filename = `${debate.ext_id}.txt`;
      await writeFile(join(vectorsDir, filename), vectorText);
      logger.info(`Generated vector file for debate: ${debate.title}`);
      return 1;
    } catch (error) {
      logger.error(`Failed to process debate ${debate.title}:`, error);
      console.error('Debate data:', JSON.stringify(debate, null, 2));
      throw error;
    }
  } catch (error) {
    console.error('Detailed error:', error);
    logger.error('Failed to generate vector:', error);
    throw error;
  }
}

async function generateCurrentWeekVectors() {
  try {
    const now = new Date();
    const mondayDateString = getMondayDateString(now);

    // Get debates from current week
    const { data: debates, error } = await SupabaseService.getCurrentWeekDebates();

    if (error) {
      logger.error('Error fetching debates:', error);
      throw error;
    }

    if (!debates || debates.length === 0) {
      logger.info('No debates found for the current week');
      return 0;
    }

    // Create vectors directory with the date of the Monday
    const vectorsDir = join(process.cwd(), 'vectors', mondayDateString);
    await mkdir(vectorsDir, { recursive: true });

    // Process each debate
    for (const debate of debates) {
      try {
        const vectorText = await formatDebateForVector(debate);
        const filename = `${debate.ext_id}.txt`;
        await writeFile(join(vectorsDir, filename), vectorText);
        logger.info(`Generated vector file for debate: ${debate.title}`);
      } catch (error) {
        logger.error(`Failed to process debate ${debate.title}:`, error);
        console.error('Debate data:', JSON.stringify(debate, null, 2));
        continue;
      }
    }

    return debates.length;
  } catch (error) {
    console.error('Detailed error:', error);
    logger.error('Failed to generate vectors:', error);
    throw error;
  }
}

// Parse command line arguments
const extId = process.argv[2];

// Run the appropriate function based on arguments
if (extId) {
  generateVectorForDebate(extId)
    .then(processedCount => {
      if (processedCount > 0) {
        logger.info(`Generated vector for debate: ${extId}`);
      }
    })
    .catch(error => logger.error('Script execution failed:', error));
} else {
  generateCurrentWeekVectors()
    .then(processedCount => logger.info(`Generated vectors for ${processedCount} debates`))
    .catch(error => logger.error('Script execution failed:', error));
} 