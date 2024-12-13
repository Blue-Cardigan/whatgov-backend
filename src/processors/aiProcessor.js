import logger from '../utils/logger.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { 
  generateSummary, 
  generateQuestions, 
  extractTopics, 
  extractKeyPoints, 
  generateDivisionQuestions, 
  generateCommentThread 
} from './generators/aiGenerators.js';
import { 
  processDebateItems, 
  formatDebateContext,
  getTypeSpecificPrompt,
  handleBritishTranslation 
} from '../utils/debateUtils.js';

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load translations
const us2gbTranslations = JSON.parse(
  readFileSync(join(__dirname, '../utils/us2gbbig.json'), 'utf8')
);

export async function processAIContent(debate, memberDetails, divisions = null, debateType, aiProcess = null) {
  try {
    const processedItems = processDebateItems(debate.Items, memberDetails);
    const context = formatDebateContext(debate.Overview, processedItems);
    const typePrompt = getTypeSpecificPrompt(debateType, debate.Overview.Location);

    // Initialize content object
    let content = {};

    // Convert aiProcess to array if it's not already
    const processesToRun = Array.isArray(aiProcess) ? aiProcess : [];
    const shouldRunAll = !aiProcess || aiProcess.length === 0;

    // Process based on specified AI process or all if none specified
    if (shouldRunAll || processesToRun.includes('summary')) {
      content.summary = await generateSummary(context, typePrompt, debateType);
      console.log('Generated summary');
    }

    if (shouldRunAll || processesToRun.includes('questions')) {
      content.questions = await generateQuestions(context, typePrompt);
      console.log('Generated questions');
    }

    if (shouldRunAll || processesToRun.includes('topics')) {
      content.topics = await extractTopics(context);
      console.log('Extracted topics');
    }

    if (shouldRunAll || processesToRun.includes('keypoints')) {
      content.keyPoints = await extractKeyPoints(context);
      console.log('Extracted key points');
    }

    if (divisions?.length && (shouldRunAll || processesToRun.includes('divisions'))) {
      try {
        content.divisionQuestions = await generateDivisionQuestions(debate, divisions, memberDetails);
      } catch (error) {
        logger.error('Failed to generate division questions:', error);
        content.divisionQuestions = [];
      }
    }

    if (shouldRunAll || processesToRun.includes('comments')) {
      content.commentThread = await generateCommentThread(context, debate.Overview.Id);
      console.log('Generated comment thread');
    }

    // Translate all content at once
    const translatedContent = translateContent(content, us2gbTranslations);

    // Log which processes were run
    logger.info('AI content generation complete', {
      debateId: debate.Overview?.Id,
      processesRun: Object.keys(content),
      requestedProcess: aiProcess || 'all'
    });

    return translatedContent;

  } catch (error) {
    logger.error('Failed to process AI content', {
      debateId: debate.Overview?.Id,
      error: error.message,
      stack: error.stack,
      cause: error.cause,
      requestedProcess: aiProcess
    });
    throw error;
  }
}

function translateContent(content, translations) {
  // Deep clone the content to avoid modifying the original
  const translatedContent = JSON.parse(JSON.stringify(content));

  // Helper function to translate strings in an object
  const translateObject = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = handleBritishTranslation(obj[key], translations);
      } else if (Array.isArray(obj[key])) {
        obj[key] = obj[key].map(item => 
          typeof item === 'string' ? handleBritishTranslation(item, translations) 
          : translateObject(item)
        );
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        translateObject(obj[key]);
      }
    }
    return obj;
  };

  return translateObject(translatedContent);
}