import logger from './logger.js';
import { 
  debateTypePrompts 
} from '../prompts/debatePrompts.js';


export function translateContent(content, translations) {
  if (!content || !translations) {
    logger.warn('Missing content or translations for British English conversion', {
      hasContent: !!content,
      hasTranslations: !!translations
    });
    return content;
  }

  try {
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
  } catch (error) {
    logger.error('Translation error:', {
      error: error.message,
      stack: error.stack
    });
    return content; // Return original content on error
  }
}

function handleBritishTranslation(text, translations) {
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

export function cleanHtmlTags(text) {
  return text.replace(/<[^>]*>/g, '');
}

export function formatDebateContext(overview, items, childDebates = []) {
  try {
    const context = [
      `Title: ${overview?.Title || ''}`,
      `Type: ${overview?.Type || ''}`,
      `House: ${overview?.House?.includes('Lords') ? 'House of Lords' : 'House of Commons'}`,
      '\nDebate Transcript:'
    ];

    // Helper function to format items
    const formatItems = (items) => {
      if (!Array.isArray(items)) return [];
      
      return items.map(item => {
        if (!item.value && !item.memberId && !item.name) return null;

        const speakerInfo = [];
        if (item.name) speakerInfo.push(`Name: ${item.name}`);
        if (item.party) speakerInfo.push(`Party: ${item.party}`);
        if (item.constituency) speakerInfo.push(`Constituency: ${item.constituency}`);
        
        const speakerLine = speakerInfo.length > 0 
          ? `Speaker [${speakerInfo.join(', ')}]:`
          : '';
        
        const contentLine = item.value ? cleanHtmlTags(item.value) : '';
        
        return [speakerLine, contentLine].filter(Boolean).join('\n');
      }).filter(Boolean);
    };

    // Format main debate items
    if (Array.isArray(items) && items.length > 0) {
      context.push(...formatItems(items));
    }

    // Format child debates
    if (Array.isArray(childDebates) && childDebates.length > 0) {
      childDebates.forEach(childDebate => {
        if (childDebate.Overview && childDebate.Items) {
          context.push(
            `\nSub-debate: ${childDebate.Overview.Title || 'Untitled'}`
          );
          context.push(...formatItems(childDebate.Items));
        }
      });
    }

    logger.debug('Formatted debate context:', {
      title: overview?.Title,
      mainItemCount: items?.length,
      childDebatesCount: childDebates?.length,
      contextLength: context.length
    });
    
    return context.join('\n\n');
  } catch (error) {
    logger.error('Error formatting debate context:', {
      error: error.message,
      stack: error.stack
    });
    return `Title: ${overview?.Title || 'Untitled'}\nType: ${overview?.Type || 'Unknown'}\n`;
  }
}

export function getTypeSpecificPrompt(debateType) {
  return debateTypePrompts[debateType] || ``;
}

export function getLastSevenDays() {
  const days = [];
  const today = new Date();
  const currentDate = new Date(today);
  let daysCollected = 0;

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  while (daysCollected < 7) {
    const dayOfWeek = currentDate.getDay();
    // Only include weekdays (Monday-Friday)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const weekday = weekdays[dayOfWeek - 1];
      const dateStr = currentDate.toISOString().split('T')[0];
      days.push(`${weekday} ${dateStr}`);
      daysCollected++;
    }
    currentDate.setDate(currentDate.getDate() - 1);
  }

  return days;
} 