import logger from './logger.js';
import { 
  locationPrompts,
  debateTypePrompts 
} from '../prompts/debatePrompts.js';

export function handleBritishTranslation(text, translations) {
  try {
    if (!text) return text;
    if (!translations) {
      logger.warn('No translations provided for British English conversion');
      return text;
    }
    
    let translatedText = text;
    for (const [american, british] of Object.entries(translations)) {
      const regex = new RegExp(`\\b${american}\\b`, 'gi');
      translatedText = translatedText.replace(regex, british);
    }

    logger.debug('Translation completed', {
      originalText: text.substring(0, 50),
      hasChanges: text !== translatedText
    });

    return translatedText;
  } catch (error) {
    logger.error('Translation error', {
      error: error.message,
      text: text?.substring(0, 50),
      stack: error.stack
    });
    return text; // Return original text on error
  }
}

export function processDebateItems(items, memberDetails) {
  const processed = [];
  let currentGroup = null;

  items.forEach(item => {
    const cleanText = cleanHtmlTags(item.Value);
    const memberInfo = memberDetails.get(item.MemberId);
    const party = memberInfo?.Party ? `(${memberInfo.Party})` : '';
    
    // Add null check and fallback for AttributedTo
    const constituency = item.AttributedTo 
      ? item.AttributedTo.split('Member of Parliament for')[1]?.split('(')[0]?.trim() 
      : '';
    
    // Format speaker with clear party affiliation and handle null AttributedTo
    const speaker = item.MemberId 
      ? `${memberInfo?.DisplayAs || ''} ${party}${constituency ? `, ${constituency}` : ''}` 
      : (item.AttributedTo || '');
    
    if (!currentGroup || currentGroup.speaker !== speaker) {
      if (currentGroup) {
        processed.push(currentGroup);
      }
      currentGroup = {
        speaker,
        text: [cleanText]
      };
    } else {
      currentGroup.text.push(cleanText);
    }
  });

  if (currentGroup) {
    processed.push(currentGroup);
  }

  return processed;
}

export function cleanHtmlTags(text) {
  return text.replace(/<[^>]*>/g, '');
}

export function formatDebateContext(overview, processedItems) {
  const context = [
    `Title: ${overview.Title}`,
    `Location: ${overview.Location}`,
    `House: ${overview.Location?.includes('Lords') ? 'House of Lords' : 'House of Commons'}`,
    '\nDebate Transcript:',
    ...processedItems.map(group => 
      `${group.speaker}:\n${group.text.join('\n')}`
    )
  ];
  
  return context.join('\n\n');
}

export function getTypeSpecificPrompt(debateType, location) {
  // Check Lords-specific prompts first
  if (location?.includes('Lords Chamber')) {
    return locationPrompts['Lords Chamber'];
  }
  
  if (location?.includes('Grand Committee')) {
    return locationPrompts['Grand Committee'];
  }

  return debateTypePrompts[debateType] || `
    This is a House of Commons proceeding.
    Focus on:
    - The specific parliamentary procedure being used
    - Key points of debate or discussion
    - Ministerial responses or commitments
    - Cross-party positions
    - Practical implications for policy or legislation`;
}