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
    const party = memberInfo?.Party || null;
    const constituency = memberInfo?.MemberFrom || null; // Corrected to MemberFrom
    
    const speaker = {
      name: item.MemberId ? memberInfo?.DisplayAs || '' : (item.AttributedTo || ''),
      memberId: item.MemberId || null,
      party,
      constituency
    };
    
    if (!currentGroup || currentGroup.speaker.name !== speaker.name) {
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
      `Speaker [ID: ${group.speaker.memberId || 'N/A'}]: ${group.speaker.name}, Party: ${group.speaker.party}, Constituency: ${group.speaker.constituency}\n${group.text.join('\n')}`
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