import { calculateDebateScore } from './scoreCalculator.js';
import { cleanHtmlTags } from './debateUtils.js';

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
        if (contributionItems.every(item => !item.Value?.trim()) && 
            !Overview.PreviousDebateExtId) {
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

    // Validate required fields g
    if (!Overview.ExtId || !Overview.Title || !Overview.Date) {
      throw new Error('Missing required fields in Overview');
    }
    
    // Calculate interest score and factors directly here
    const scoreData = calculateDebateScore(debateDetails);

    // Get day of week from date with error handling
    let dayOfWeek = '';
    try {
      dayOfWeek = new Date(Overview.Date).toLocaleDateString('en-UK', { weekday: 'long' }).trim();
      if (dayOfWeek === 'Invalid Date') {
        throw new Error('Invalid date');
      }
    } catch (error) {
      console.error('Failed to parse date:', Overview.Date);
      dayOfWeek = '';
    }

    const type = getDebateType(Overview);

    // Enhanced speakers array extraction with full details
    const speakers = Items
      .filter(item => item?.ItemType === 'Contribution')
      .map(item => {
        const memberInfo = memberDetails.get(item.MemberId);
        return {
          name: memberInfo?.DisplayAs || item.MemberName || '',
          memberId: item.MemberId || null,
          party: memberInfo?.Party || null,
          constituency: memberInfo?.MemberFrom || null
        };
      })
      .filter((speaker, index, self) => 
        index === self.findIndex(s => 
          s.name === speaker.name && 
          s.memberId === speaker.memberId
        )
      );

    // Enhanced search text generation
    const searchText = Items
      .filter(item => item?.ItemType === 'Contribution')
      .map(item => {
        const memberInfo = memberDetails.get(item.MemberId);
        const speakerDetails = [
          memberInfo?.DisplayAs || item.MemberName || item.AttributedTo,
          memberInfo?.Party,
          memberInfo?.MemberFrom
        ].filter(Boolean).join(' ');
        
        return `[${speakerDetails}] ${cleanHtmlTags(item.Value || '')}`;
      })
      .join('\n')
      .trim();

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
      
      // Updated topics with full speaker details
      ai_topics: (debateDetails.topics || []).map(topic => ({
        ...topic,
        speakers: topic.speakers.map(speaker => ({
          name: speaker.name,
          memberId: speaker.memberId,
          party: speaker.party,
          constituency: speaker.constituency,
          subtopics: speaker.subtopics,
          frequency: speaker.frequency
        }))
      })),
      
      // Updated key points with full speaker details
      ai_key_points: debateDetails.keyPoints?.keyPoints?.map(point => ({
        point: point.point,
        speaker: {
          name: point.speaker.name,
          memberId: point.speaker.memberId,
          party: point.speaker.party,
          constituency: point.speaker.constituency
        },
        support: point.support.map(supporter => ({
          name: supporter.name,
          memberId: supporter.memberId,
          party: supporter.party,
          constituency: supporter.constituency
        })),
        opposition: point.opposition.map(opposer => ({
          name: opposer.name,
          memberId: opposer.memberId,
          party: opposer.party,
          constituency: opposer.constituency
        })),
        keywords: point.keywords || [],
        context: point.context
      })) || [],
      
      // Updated comment thread with full speaker details
      ai_comment_thread: (debateDetails.commentThread?.comments || []).map(comment => ({
        ...comment,
        author: {
          name: comment.author.name,
          memberId: comment.author.memberId,
          party: comment.author.party,
          constituency: comment.author.constituency
        },
        votes: {
          ...comment.votes,
          upvotes_speakers: comment.votes.upvotes_speakers.map(speaker => ({
            name: speaker.name,
            memberId: speaker.memberId,
            party: speaker.party,
            constituency: speaker.constituency
          })),
          downvotes_speakers: comment.votes.downvotes_speakers.map(speaker => ({
            name: speaker.name,
            memberId: speaker.memberId,
            party: speaker.party,
            constituency: speaker.constituency
          }))
        }
      })),
      
      speaker_count: speakers.length,
      speakers: speakers,
      contribution_count: Items.filter(item => item?.ItemType === 'Contribution').length,
      party_count: debateDetails.partyCount || {},
      interest_score: scoreData.score,
      interest_factors: scoreData.factors,
      
      parent_ext_id: parent.ExternalId || '',
      parent_title: parent.Title || '',
      prev_ext_id: Overview.PreviousDebateExtId || null,
      next_ext_id: Overview.NextDebateExtId || null,
      
      search_text: searchText,
      
      ai_question: debateDetails.questions?.question?.text || '',
      ai_question_topic: debateDetails.questions?.question?.topic || '',
      ai_question_subtopics: debateDetails.questions?.question?.subtopics || [],
      ai_question_ayes: 0,
      ai_question_noes: 0
    };
  } catch (error) {
    console.error('Transform debate error:', error);
    throw error;
  }
}

export function transformSpeaker(apiSpeaker) {
  return {
    name: apiSpeaker.DisplayAs || '',
    memberId: apiSpeaker.MemberId || null,
    party: apiSpeaker.Party || null,
    constituency: apiSpeaker.MemberFrom || null
  };
}

// Export the helper function
export { getDebateType }; 