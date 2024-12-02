#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { HansardAPI } from '../services/hansard-api.js';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATCHES_FILE = path.join(__dirname, '../../speaker_matches.json');
const SIMILARITY_THRESHOLD = 0.7;

// Create a Supabase client with service role key to bypass RLS
if (!config.SUPABASE_URL || !config.SERVICE_KEY) {
  logger.error('Missing required environment variables:', {
    hasUrl: !!config.SUPABASE_URL,
    hasServiceKey: !!config.SERVICE_KEY
  });
  process.exit(1);
}

const supabase = createClient(
  config.SUPABASE_URL,
  config.SERVICE_KEY
);

async function loadExistingMatches() {
  try {
    const data = await fs.readFile(MATCHES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist or is invalid, return empty object
    return {};
  }
}

async function saveMatches(matches) {
  await fs.writeFile(MATCHES_FILE, JSON.stringify(matches, null, 2), 'utf8');
}

async function normalizeSpeakerNames() {
  try {
    logger.info('Starting speaker name normalization...');
    
    // Load existing matches
    const matches = await loadExistingMatches();
    
    const { data: speakers, error } = await supabase
      .from('speakers')
      .select('name')
      .neq('name', null);

    if (error) {
      logger.error('Failed to fetch speakers:', {
        error: error.message,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }

    const uniqueSpeakers = [...new Set(speakers.map(s => s.name))].map(name => ({ name }));
    logger.info('Fetched unique speakers', { count: uniqueSpeakers.length });

    let updatedCount = 0;
    
    for (const speaker of uniqueSpeakers) {
      try {
        if (!speaker.name) {
          logger.warn('Skipping speaker with null name');
          continue;
        }

        logger.info('Processing speaker:', { name: speaker.name });
        
        // Search for each speaker name
        const searchResults = await HansardAPI.searchMembers({ name: speaker.name });
        
        if (searchResults.Results && searchResults.Results.length > 0) {
          // Find the best match using string similarity
          const bestMatch = findBestMatch(speaker.name, searchResults.Results);
          
          if (bestMatch) {
            const officialName = bestMatch.result.DisplayAs;
            
            if (officialName !== speaker.name) {
              // Log match details regardless of similarity score
              logger.info('Found name match:', {
                from: speaker.name,
                to: officialName,
                similarity: bestMatch.score,
                isGoodMatch: bestMatch.score >= SIMILARITY_THRESHOLD
              });

              // Only store matches that meet the threshold
              if (bestMatch.score >= SIMILARITY_THRESHOLD) {
                matches[speaker.name] = {
                  currentName: speaker.name,
                  suggestedName: officialName,
                  similarity: bestMatch.score,
                  apiResult: bestMatch.result,
                  timestamp: new Date().toISOString()
                };

                // Save matches after each new finding
                await saveMatches(matches);
              }
            }
          }
        } else {
          logger.info('No matches found for speaker:', { name: speaker.name });
        }

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error('Error processing speaker:', {
          speaker: speaker.name,
          error: error.message,
          stack: error.stack
        });
      }
    }

    logger.info('Speaker name normalization completed', { 
      totalProcessed: uniqueSpeakers.length,
      matchesFound: Object.keys(matches).length
    });
    
    process.exit(0);
  } catch (error) {
    logger.error('Speaker name normalization failed:', {
      error: error.message,
      stack: error.stack,
      details: error.details || {}
    });
    process.exit(1);
  }
}

// Helper function to find the best match using string similarity
function findBestMatch(speakerName, results) {
  let bestMatch = null;
  let bestScore = 0;

  for (const result of results) {
    const score = calculateStringSimilarity(speakerName.toLowerCase(), result.DisplayAs.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      bestMatch = result;
    }
  }

  return bestMatch ? { result: bestMatch, score: bestScore } : null;
}

// Simple string similarity function (Levenshtein distance based)
function calculateStringSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const matrix = Array(str2.length + 1).fill(null)
    .map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }

  return matrix[str2.length][str1.length];
}

normalizeSpeakerNames(); 