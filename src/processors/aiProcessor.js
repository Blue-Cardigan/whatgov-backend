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

export async function processAIContent(debate, memberDetails, divisions = null, debateType, aiProcesses = null) {
  try {
    // Get debate context and type-specific prompt
    const processedItems = processDebateItems(debate.Items, memberDetails);
    const context = formatDebateContext(debate.Overview, processedItems);
    const typePrompt = getTypeSpecificPrompt(debateType, debate.Overview.Location);

    // Initialize content object
    let content = {};

    // Convert single process to array for consistency
    const processes = Array.isArray(aiProcesses) ? aiProcesses : [aiProcesses];

    // Process based on specified AI processes or all if none specified
    if (!processes.length || processes.includes('summary')) {
      content.summary = await generateSummary(context, typePrompt);
      console.log('Generated summary');
    }

    if (!processes.length || processes.includes('questions')) {
      content.questions = await generateQuestions(context, typePrompt);
      console.log('Generated questions');
    }

    if (!processes.length || processes.includes('topics')) {
      content.topics = await extractTopics(context);
      console.log('Extracted topics');
    }

    if (!processes.length || processes.includes('keypoints')) {
      content.keyPoints = await extractKeyPoints(context);
      console.log('Extracted key points');
    }

    if (divisions?.length && (!processes.length || processes.includes('divisions'))) {
      content.divisionQuestions = await generateDivisionQuestions(debate, divisions, memberDetails);
      console.log('Generated division questions');
    }

    if (!processes.length || processes.includes('comments')) {
      content.commentThread = await generateCommentThread(context, debate.Overview.Id);
      console.log('Generated comment thread');
    }

    // Translate all content at once
    const translatedContent = translateContent(content, us2gbTranslations);

    // Log which processes were run
    logger.info('AI content generation complete', {
      debateId: debate.Overview?.Id,
      processesRun: Object.keys(content),
      requestedProcesses: processes.length ? processes.join(', ') : 'all'
    });

    return translatedContent;

  } catch (error) {
    logger.error('Failed to process AI content', {
      debateId: debate.Overview?.Id,
      error: error.message,
      stack: error.stack,
      cause: error.cause,
      requestedProcesses: Array.isArray(aiProcesses) ? aiProcesses.join(', ') : aiProcesses
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