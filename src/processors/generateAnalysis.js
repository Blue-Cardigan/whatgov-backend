import { openai } from '../services/openai.js';
import { getPrompt } from '../prompts/debatePrompts.js';
import { debateResponseFormat } from '../prompts/debatePrompts.js';
import logger from '../utils/logger.js';

function estimateTokens(text) {
  // Rough estimate: average English word is ~1.3 tokens
  // Add 20% buffer for special characters and formatting
  return Math.ceil(text.split(/\s+/).length * 1.3 * 1.2);
}

function trimDebateContext(context, maxTokens = 120000) {
  const estimatedTokens = estimateTokens(context);
  
  if (estimatedTokens <= maxTokens) {
    return context;
  }

  logger.debug('Trimming debate context:', {
    estimatedTokens,
    maxTokens,
    reductionNeeded: estimatedTokens - maxTokens
  });

  // Split into sections (usually divided by speaker)
  const sections = context.split(/(?=\*\*[^*]+\*\*)/);
  
  // Keep introduction and important sections
  const intro = sections[0];
  sections.shift();

  // Calculate estimated tokens for intro
  const introTokens = estimateTokens(intro);
  const remainingTokens = maxTokens - introTokens;
  
  // Prioritize sections with key indicators
  const prioritizedSections = sections.map(section => {
    const priority = calculateSectionPriority(section);
    return { 
      section, 
      priority, 
      tokens: estimateTokens(section)
    };
  }).sort((a, b) => b.priority - a.priority);

  // Build trimmed context
  let trimmedContext = intro;
  let currentTokens = introTokens;

  for (const { section, tokens } of prioritizedSections) {
    if (currentTokens + tokens <= maxTokens) {
      trimmedContext += section;
      currentTokens += tokens;
    } else {
      break;
    }
  }

  logger.debug('Trimmed debate context:', {
    estimatedFinalTokens: estimateTokens(trimmedContext),
    sectionsKept: trimmedContext.split(/(?=\*\*[^*]+\*\*)/).length,
    originalSections: sections.length
  });

  return trimmedContext;
}

function calculateSectionPriority(section) {
  let priority = 0;
  
  // Prioritize ministerial responses
  if (/Minister|Secretary/.test(section)) priority += 5;
  
  // Prioritize sections with data
  if (/[0-9]+%|£[0-9]+|billion|million/.test(section)) priority += 3;
  
  // Prioritize policy discussions
  if (/policy|legislation|amendment|bill/i.test(section)) priority += 2;
  
  // Prioritize questions and responses
  if (/\?/.test(section)) priority += 1;
  
  return priority;
}

export async function generateAnalysis(debate, uniqueSpeakers = []) {
  try {
    // Validate inputs
    if (!debate || !debate.context) {
      throw new Error('Invalid debate input');
    }

    logger.debug('Generating analysis for debate:', {
      id: debate.id,
      contextLength: debate.context.length,
      speakerCount: uniqueSpeakers.length
    });

    // Trim context if needed
    const trimmedContext = trimDebateContext(debate.context);
    
    // Update debate object with trimmed context
    const processedDebate = {
      ...debate,
      context: trimmedContext
    };

    const contextWords = trimmedContext.split(/\s+/).length;
    const speakerCount = uniqueSpeakers?.length || 0;  // Add safe access
    
    // Estimate max tokens needed
    const maxTokens = Math.min(4096, Math.floor(
      (contextWords * 1.5) + (speakerCount * 200)
    ));

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: getPrompt(processedDebate, uniqueSpeakers)
      }],
      max_tokens: maxTokens,
      response_format: debateResponseFormat()
    });

    // Parse the response to ensure it's valid JSON
    const analysisContent = JSON.parse(completion.choices[0].message.content);
    
    return {
      analysis: analysisContent.analysis,
      speaker_points: analysisContent.speaker_points,
      custom_id: debate.ext_id // Add this to help with matching later
    };

  } catch (error) {
    logger.error('Failed to generate analysis:', {
      error: error.message,
      debateId: debate.id,
      speakerCount: uniqueSpeakers.length
    });
    throw error;
  }
}