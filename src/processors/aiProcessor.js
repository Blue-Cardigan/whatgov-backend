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

function translateContent(content) {
  if (typeof content === 'string') {
    return handleBritishTranslation(content, us2gbTranslations);
  }
  if (Array.isArray(content)) {
    return content.map(item => translateContent(item));
  }
  if (typeof content === 'object' && content !== null) {
    const translated = {};
    for (const [key, value] of Object.entries(content)) {
      translated[key] = translateContent(value);
    }
    return translated;
  }
  return content;
}

export async function processAIContent(debate, memberDetails, divisions = null, debateType) {
  try {
    const processedItems = processDebateItems(debate.Items, memberDetails);
    const debateText = formatDebateContext(debate.Overview, processedItems);
    const location = debate.Overview?.Location;
    const typeSpecificPrompt = getTypeSpecificPrompt(debateType, location);

    logger.debug('Processing AI content', {
      debateId: debate.Overview?.Id,
      textLength: debateText.length,
      itemCount: processedItems.length,
      debateType,
      location
    });

    try {
      // Generate all AI responses concurrently
      const [summary, questions, topics, keyPoints, divisionQuestions, commentThread] = await Promise.all([
        generateSummary(debateText, typeSpecificPrompt),
        generateQuestions(debateText, typeSpecificPrompt, debateType),
        extractTopics(debateText),
        extractKeyPoints(debateText),
        divisions ? generateDivisionQuestions(debate, divisions, memberDetails) : [],
        generateCommentThread(debateText, debate.Overview?.Id)
      ]);

      // Validate responses
      if (!summary || !questions || !topics || !keyPoints) {
        throw new Error('Missing required AI content');
      }

      // Ensure questions has the expected structure
      if (!questions.question) {
        throw new Error('Invalid questions structure');
      }

      // Translate all content to British English
      const translatedContent = {
        summary: translateContent(summary),
        questions: translateContent(questions),
        topics: translateContent(topics),
        keyPoints: translateContent(keyPoints),
        divisionQuestions: translateContent(divisionQuestions),
        commentThread: translateContent(commentThread)
      };

      // Validate translated content
      if (!translatedContent.summary || !translatedContent.questions?.question) {
        throw new Error('Translation resulted in invalid content structure');
      }

      return translatedContent;

    } catch (error) {
      logger.error('Failed during AI content generation', {
        debateId: debate.Overview?.Id,
        error: error.message,
        stack: error.stack,
        cause: error.cause
      });
      throw error;
    }
  } catch (error) {
    logger.error('Failed to process AI content', {
      debateId: debate.Overview?.Id,
      error: error.message,
      stack: error.stack,
      cause: error.cause
    });
    throw error;
  }
}