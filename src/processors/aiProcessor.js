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
    // Get debate context and type-specific prompt
    const processedItems = processDebateItems(debate.Items, memberDetails);
    const context = formatDebateContext(debate.Overview, processedItems);
    const typePrompt = getTypeSpecificPrompt(debateType, debate.Overview.Location);

    // Initialize content object
    let content = {};

    // Process based on specified AI process or all if none specified
    if (!aiProcess || aiProcess === 'summary') {
      content.summary = await generateSummary(context, typePrompt);
      logger.debug('Generated summary');
    }

    if (!aiProcess || aiProcess === 'questions') {
      content.questions = await generateQuestions(context, typePrompt);
      logger.debug('Generated questions');
    }

    if (!aiProcess || aiProcess === 'topics') {
      content.topics = await extractTopics(context);
      logger.debug('Extracted topics');
    }

    if (!aiProcess || aiProcess === 'keypoints') {
      content.keyPoints = await extractKeyPoints(context);
      logger.debug('Extracted key points');
    }

    if (divisions?.length && (!aiProcess || aiProcess === 'divisions')) {
      content.divisionQuestions = await generateDivisionQuestions(context, divisions);
      logger.debug('Generated division questions');
    }

    if (!aiProcess || aiProcess === 'comments') {
      content.commentThread = await generateCommentThread(context, debate.Overview.Id);
      logger.debug('Generated comment thread');
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