import { calculateDebateScore } from './scoreCalculator.js';

export function validateDebateContent(debateDetails) {
  try {
    // Validate input
    if (!debateDetails?.Overview) {
      throw new Error('Missing required debate overview data');
    }

    const { Items = [], Overview } = debateDetails;

    // Skip prayers in both Houses
    if (Overview.Title?.includes('Prayer')) {
      console.log('Skipping debate with Prayer title');
      return null;
    }
    
    // Skip if HRSTag contains 'BigBold'
    if (Overview.HRSTag?.includes('BigBold')) {
      console.log('Skipping debate with HRSTag containing BigBold');
      return null;
    }

    // Get all contribution items
    const contributionItems = Items.filter(item => item?.ItemType === 'Contribution');
    
    // Modified check for contributions - different rules for Lords
    if (contributionItems.length > 0) {
      if (Overview.House === 'Commons') {
        // Commons-specific check
        if (contributionItems.every(item => !item.MemberId) && 
            !Overview.PreviousDebateExtId) {
          return null;
        }
      } else if (Overview.House === 'Lords') {
        // Lords-specific check - more lenient on MemberId requirement
        if (contributionItems.every(item => !item.Value?.trim())) {
          return null;
        }
      }
    }
    
    // Get cleaned search text first to validate content
    const searchText = (Items || [])
      .filter(item => item?.ItemType === 'Contribution')
      .map(item => item?.Value || '')
      .join(' ')
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .trim(); // Trim whitespace
    
    // Return null if no meaningful content
    if (!searchText) {
      return null;
    }

    return 'valid';
  } catch (error) {
    console.error('Filter debate content error:', error);
    return null;
  }
}

// Add new helper function
function getDebateType(overview) {
  // Check for Lords debates first based on location
  if (overview.Location?.includes('Lords')) {
    if (overview.Location?.includes('Grand Committee')) {
      return 'Grand Committee';
    }
    if (overview.Location?.includes('Chamber')) {
      return 'Lords Chamber';
    }
  }

  if (overview.Title?.includes('Prime Minister')) {
    return 'Prime Minister\'s Questions';
  }

  // Process Commons debate types
  let type = (overview.HRSTag || '')
    .replace(/^hs_/, '')
    .replace(/Hdg/, '')
    .replace(/^(?:2c|2|3c|6b|8|3)/, '')
    .replace(/WestHallDebate/, 'Westminster Hall')
    .replace(/Department/, 'Department Questions')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/Bill Title/, 'Bill Procedure')
    .replace(/Business WO Debate/, 'Business Without Debate')
    .replace(/Deb Bill/, 'Debated Bill')
    .trim();

  // Additional type detection for Commons
  if (!type) {
    if (overview.Location?.includes('Public Bill Committees') && !overview.Location?.includes('Lords')) {
      type = 'Public Bill Committees';
    } else if (overview.Location?.includes('General Committees') && !overview.Location?.includes('Lords')) {
      type = 'General Committees';
    } else if (overview.Title?.includes('Urgent Question')) {
      type = 'Urgent Question';
    } else if (overview.Title?.includes('Statement')) {
      type = 'Statement';
    }
  }

  // If still no type but in Commons, set as general debate
  if (!type && overview.House === 'Commons') {
    type = 'General Debate';
  }

  return type;
}

export function transformDebate(debateDetails, memberDetails = new Map()) {
  try {
    const { Navigator = [], Overview = {}, Items = [] } = debateDetails;
    const parent = Navigator[Navigator.length - 2] || {};
    
    // Find the debate's Timecode from Navigator
    const debateNode = Navigator.find(n => n.ExternalId === Overview.ExtId);
    const startTime = debateNode?.Timecode || null;

    // Validate required fields
    if (!Overview.ExtId || !Overview.Title || !Overview.Date) {
      throw new Error('Missing required fields in Overview');
    }
    
    // Calculate interest score and factors directly here
    const scoreData = calculateDebateScore(debateDetails);

    // Get day of week from date with error handling
    let dayOfWeek = '';
    try {
      dayOfWeek = new Date(Overview.Date).toLocaleDateString('en-UK', { weekday: 'long' }).trim();
      // Verify we got a valid day (in case date parsing succeeded but gave wrong date)
      if (dayOfWeek === 'Invalid Date') {
        throw new Error('Invalid date');
      }
    } catch (error) {
      console.error('Failed to parse date:', Overview.Date);
      dayOfWeek = '';
    }

    // Replace type determination with new helper function
    const type = getDebateType(Overview);

    // Enhanced speakers array extraction with full details
    const speakers = Items
      .filter(item => item?.ItemType === 'Contribution' && item?.MemberId)
      .map(item => ({
        member_id: item.MemberId,
        display_as: memberDetails.get(item.MemberId)?.DisplayAs || item.MemberName || '',
        party: memberDetails.get(item.MemberId)?.Party || ''
      }))
      .filter((speaker, index, self) => 
        speaker.member_id && 
        index === self.findIndex(s => s.member_id === speaker.member_id)
      );

    return {
      ext_id: Overview.ExtId,
      title: Overview.Title || '',
      date: Overview.Date,
      day_of_week: dayOfWeek,
      start_time: startTime,
      type: type,
      house: Overview.House || '',
      location: Overview.Location || '',

      ai_title: debateDetails.summary?.title || '',
      ai_summary: [
        debateDetails.summary?.sentence1 || '',
        debateDetails.summary?.sentence2 || '',
        debateDetails.summary?.sentence3 || ''
      ].join('\n'),
      ai_tone: (debateDetails.summary?.tone || 'neutral').toLowerCase(),
      
      // Properly parse topics according to TopicSchema
      ai_topics: debateDetails.topics || [],
      
      ai_key_points: debateDetails.keyPoints?.keyPoints?.map(point => ({
        point: point.point,
        speaker: point.speaker,
        support: point.support || [],
        opposition: point.opposition || []
      })) || [],
      
      ai_comment_thread: debateDetails.commentThread?.comments || [],
      
      speaker_count: speakers.length,
      speakers: speakers, // Now contains array of objects with member_id, display_as, and party
      contribution_count: (Items || []).filter(item => item?.ItemType === 'Contribution').length,
      party_count: debateDetails.partyCount || {},
      interest_score: scoreData.score,
      interest_factors: scoreData.factors,
      
      // Navigation
      parent_ext_id: parent.ExternalId || '',
      parent_title: parent.Title || '',
      prev_ext_id: Overview.PreviousDebateExtId || null,
      next_ext_id: Overview.NextDebateExtId || null,
      
      // Search optimization
      search_text: (Items || [])
        .filter(item => item?.ItemType === 'Contribution')
        .map(item => item?.Value || '')
        .join(' ')
        .replace(/<[^>]*>/g, '')
        .trim(),
      
      // Individual question fields
      ai_question: debateDetails.questions?.question?.text || '',
      ai_question_topic: debateDetails.questions?.question?.topic || '',
      ai_question_ayes: 0,
      ai_question_noes: 0,
    };
  } catch (error) {
    console.error('Transform debate error:', error);
    throw error;
  }
}

export function transformSpeaker(apiSpeaker) {
  return {
    member_id: apiSpeaker.MemberId,
    name: apiSpeaker.DisplayAs,
    party: apiSpeaker.Party,
    constituency: apiSpeaker.MemberFrom
  };
}

// Export the helper function
export { getDebateType }; 