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

    // Add minimum content validation
    if (debate.context.split(/\s+/).length < 50) {
      logger.warn('Debate content too short for meaningful analysis');
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
    const speakerCount = uniqueSpeakers?.length || 0;
    
    // Estimate max tokens needed
    const maxTokens = Math.min(4096, Math.floor(
      Math.max(800, (contextWords * 0.75) + (speakerCount * 150))
    ));

    if (contextWords < 50) {
      logger.warn('Debate content too short for meaningful analysis');
      return null;
    }

    console.log(maxTokens)

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: prompt
      }],
      max_tokens: maxTokens,
      response_format: debateResponseFormat()
    });

    // Add error handling and logging for JSON parsing
    let analysisContent;
    try {
      const rawContent = completion.choices[0].message.content;
      logger.debug('Raw API response:', rawContent);
      
      // Add validation check
      if (!rawContent || typeof rawContent !== 'string') {
        throw new Error('Invalid API response format');
      }
      
      // Verify the response appears to be complete JSON
      if (!rawContent.trim().endsWith('}')) {
        throw new Error('Incomplete JSON response');
      }
      
      analysisContent = JSON.parse(rawContent);
    } catch (parseError) {
      logger.error('JSON parsing failed:', {
        error: parseError.message,
        rawContent: completion.choices[0].message.content
      });
      throw new Error(`Failed to parse API response: ${parseError.message}`);
    }
    
    return {
      analysis: analysisContent.analysis,
      speaker_points: analysisContent.speaker_points,
      custom_id: debate.ext_id
    };

  } catch (error) {
    error.prompt = getPrompt(debate, uniqueSpeakers);
    error.raw_response = error.raw_response || null;
    
    logger.error('Failed to generate analysis:', {
      error: error.message,
      debateId: debate.id,
      speakerCount: uniqueSpeakers.length
    });
    throw error;
  }
}