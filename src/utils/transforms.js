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
  if (overview.Location?.includes('Grand Committee')) {
    return 'Grand Committee';
  }
  if (overview.Location?.includes('Chamber')) {
    return 'Lords Chamber';
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
    const { 
      Navigator = [], 
      Overview = {}, 
      Items = [], 
      stats = {},
      summary,
      topics,
      keyPoints,
      commentThread,
      questions
    } = debateDetails;

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

      ai_title: summary?.title || '',
      ai_summary: [
        summary?.summary
      ].join('\n'),
      ai_overview: summary?.overview || '',
      ai_tone: (summary?.tone || 'neutral').toLowerCase(),
      
      ai_topics: (topics || []).map(topic => ({
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
      
      ai_key_points: keyPoints?.keyPoints?.map(point => ({
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
      
      ai_comment_thread: (commentThread?.comments || []).map(comment => ({
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
      
      speaker_count: stats.speakerCount || 0,
      speakers: speakers,
      contribution_count: stats.contributionCount || 0,
      party_count: stats.partyCount || {},
      interest_score: scoreData.score,
      interest_factors: scoreData.factors,
      
      parent_ext_id: parent.ExternalId || '',
      parent_title: parent.Title || '',
      prev_ext_id: Overview.PreviousDebateExtId || null,
      next_ext_id: Overview.NextDebateExtId || null,
      
      search_text: searchText,
      
      ai_question: questions?.question?.text || '',
      ai_question_topic: questions?.question?.topic || '',
      ai_question_subtopics: questions?.question?.subtopics || [],
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

// Add a separate function for transforming divisions
export function transformDivisions(divisions = []) {
  return divisions?.map(division => ({
    division_id: division.division_id,
    external_id: division.external_id,
    debate_section_ext_id: division.debate_section_ext_id,
    date: division.date,
    time: division.time,
    has_time: division.has_time,
    ayes_count: division.ayes_count,
    noes_count: division.noes_count,
    house: division.house,
    debate_section: division.debate_section,
    debate_section_source: division.debate_section_source,
    division_number: division.division_number,
    text_before_vote: division.text_before_vote,
    text_after_vote: division.text_after_vote,
    evel_type: division.evel_type,
    evel_info: division.evel_info,
    evel_ayes_count: division.evel_ayes_count,
    evel_noes_count: division.evel_noes_count,
    is_committee_division: division.is_committee_division,
    ai_question: division.ai_question,
    ai_topic: division.ai_topic,
    ai_context: division.ai_context,
    ai_key_arguments: division.ai_key_arguments || {
      for: null,
      against: null
    },
    aye_members: division.aye_members || [],
    noe_members: division.noe_members || []
  })) || [];
}

// Normalize AI content before upserting specific ai processed fields
export function normalizeAIContent(aiContent) { 
  if (!aiContent) return null;

  const normalized = {};

  // Map camelCase to snake_case with ai_ prefix
  const fieldMappings = {
    commentThread: 'ai_comment_thread',
    title: 'ai_title',
    summary: 'ai_summary',
    overview: 'ai_overview',
    tone: 'ai_tone',
    topics: 'ai_topics',
    keyPoints: 'ai_key_points',
    question: 'ai_question',
    questionTopic: 'ai_question_topic',
    questionSubtopics: 'ai_question_subtopics',
    questionAyes: 'ai_question_ayes',
    questionNoes: 'ai_question_noes',
    divisionQuestions: 'ai_division_questions'
  };

  // Convert each field if it exists
  Object.entries(aiContent).forEach(([key, value]) => {
    const normalizedKey = fieldMappings[key];
    if (normalizedKey) {
      normalized[normalizedKey] = value;
    } else {
      // If no mapping exists, prefix with ai_ and convert to snake_case
      const snakeCase = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      normalized[`ai_${snakeCase}`] = value;
    }
  });

  return normalized;
}

// Export the helper function
export { getDebateType }; 