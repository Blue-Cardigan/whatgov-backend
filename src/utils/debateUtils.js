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
  if (!items) {
    logger.warn('No items provided to processDebateItems');
    return [];
  }

  try {
    return items.map(item => {
      const processedItem = {
        id: item.ItemId || item.Id,
        externalId: item.ExternalId,
        type: item.ItemType || item.Type,
        text: item.Value || item.Text,
        time: item.Timecode || item.Time,
        memberId: item.MemberId,
        memberName: item.AttributedTo || item.MemberName
      };
      
      // Add member details if available
      if (item.MemberId && memberDetails?.get?.(item.MemberId)) {
        const details = memberDetails.get(item.MemberId);
        processedItem.speaker = {
          memberId: item.MemberId,
          name: details.DisplayAs,
          party: details.Party,
          constituency: details.MemberFrom
        };
      }
      
      return processedItem;
    }).filter(Boolean); // Remove any null/undefined items
  } catch (error) {
    logger.error('Error processing debate items:', {
      error: error.message,
      stack: error.stack,
      itemsProvided: !!items,
      itemCount: items?.length,
      sampleItem: items?.[0] ? JSON.stringify(items[0]).slice(0, 200) : null
    });
    return [];
  }
}

export function cleanHtmlTags(text) {
  return text.replace(/<[^>]*>/g, '');
}

export function formatDebateContext(overview, processedItems) {
  try {
    const context = [
      `Title: ${overview?.Title || ''}`,
      `Type: ${overview?.Type || ''}`,
      `House: ${overview?.House?.includes('Lords') ? 'House of Lords' : 'House of Commons'}`,
      '\nDebate Transcript:'
    ];

    // Handle different item structures
    if (Array.isArray(processedItems)) {
      const formattedItems = processedItems.map(item => {
        // Handle group structure
        if (item.speaker && item.text) {
          const speaker = item.speaker;
          return `Speaker [ID: ${speaker.memberId || 'N/A'}]: ${speaker.name || 'Unknown'}, ` +
            `Party: ${speaker.party || 'Unknown'}, ` +
            `Constituency: ${speaker.constituency || 'N/A'}\n` +
            `${Array.isArray(item.text) ? item.text.join('\n') : item.text}`;
        }
        
        // Handle flat structure
        return `Speaker [ID: ${item.memberId || 'N/A'}]: ${item.memberName || 'Unknown'}, ` +
          `${item.memberDetails ? `Party: ${item.memberDetails.Party || 'Unknown'}, ` +
          `Constituency: ${item.memberDetails.MemberFrom || 'N/A'}` : ''}\n` +
          `${item.text || ''}`;
      });
      
      context.push(...formattedItems);
    } else {
      logger.warn('Invalid processedItems structure:', {
        type: typeof processedItems,
        sample: processedItems ? JSON.stringify(processedItems).slice(0, 100) : 'null'
      });
    }

    logger.debug('Formatted debate context:', {
      title: overview?.Title,
      itemCount: processedItems?.length,
      contextLength: context.length
    });
    
    return context.join('\n\n');
  } catch (error) {
    logger.error('Error formatting debate context:', {
      error: error.message,
      stack: error.stack,
      overview: overview ? Object.keys(overview) : null,
      itemsSample: processedItems ? processedItems.slice(0, 2) : null
    });
    
    // Return a basic context if there's an error
    return `Title: ${overview?.Title || 'Untitled'}\nLocation: ${overview?.Location || 'Unknown'}\n`;
  }
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