import { cleanHtmlTags } from './debateUtils.js';

export function validateDebateContent(debateDetails) {
  try {
    // Early return if debate details is null/undefined
    if (!debateDetails) {
      return null;
    }

    if (debateDetails.Items.length === 0) {
      return null;
    }

    const overview = debateDetails.Overview;

    // Skip prayers in both Houses
    if (overview.Title?.includes('Prayer')) {
      return null;
    }

    if (overview.NextDebateTitle?.includes('Prayer')) {
      return null;
    }
    
    // Skip if HRSTag contains 'BigBold'
    if (overview.HRSTag?.includes('BigBold')) {
      return null;
    }

    // Skip if all memberId values are null
    if (debateDetails.Items.every(item => item?.MemberId === null)) {
      return null;
    }

    // Skip debates with a single contribution under 100 words
    if (debateDetails.Items.length === 1 && debateDetails.Items[0]?.ItemType === 'Contribution') {
      const wordCount = debateDetails.Items[0].Value
        ? debateDetails.Items[0].Value.trim().split(/\s+/).length
        : 0;
      
      if (wordCount < 100) {
        return null;
      }
    }

    return 'valid';
  } catch (error) {
    console.error('Filter debate content error:', {
      error: error.message,
      stack: error.stack,
      debateId: debateDetails?.Overview?.ExtId || 'unknown'
    });
    return null;
  }
}

// Add new helper function
function getDebateType(overview) {
  // Check for Lords debates first based on location
  if (overview.Location?.includes('Grand Committee')) {
    return 'Grand Committee';
  }
  if (overview.Location?.includes('Lords Chamber')) {
    return 'Lords Chamber';
  }

  if (overview.Title?.includes('Prime Minister')) {
    return 'Prime Minister\'s Questions';
  }

  // Process Commons debate types
  let type = (overview.HRSTag || 'Committee')
    .replace('hs_2BillTitle', 'Bill Reading')
    .replace('hs_2cBillTitle', 'Bill Reading')
    .replace('hs_8Question', 'Question')
    .replace('hs_8Statement', 'Written Statement')
    .replace('hs_8Petition', 'Petition')
    .replace('hs_2cStatement', 'Statement')
    .replace('hs_2cUrgentQuestion', 'Urgent Question')
    .replace('hs_2DebBill', 'Debated Bill')
    .replace('hs_6bDepartment', 'Department Question')
    .replace('hs_2BusinessWODebate', 'Business Without Debate')
    .replace('hs_2cWestHallDebate', 'Westminster Hall')
    .replace('hs_2WestHallDebate', 'Westminster Hall')
    .replace('hs_2DebBill', 'Debated Bill')
    .replace('hs_2cGenericHdg', 'General Debate')
    .replace('hs_2cDebatedMotion', 'Debated Motion')
    .replace('hs_2DebatedMotion', 'Debated Motion')
    .replace('hs_3MainHdg', 'Main')
    .replace('hs_2GenericHdg', 'Generic Debate')
    // Used for lords debates unpredictably so replace with location below
    // .replace('NewDebate', 'New Debate')
    // .replace('hs_Venue', 'Venue')

  // Additional type detection for Commons
  if (!type) {
    if (overview.Location?.includes('Public Bill Committees') && !overview.Location?.includes('Lords')) {
      type = 'Public Bill Committees';
    } else if (overview.Location?.includes('General Committees') && !overview.Location?.includes('Lords')) {
      type = 'General Committees';
    }
    else if (overview.Location?.includes('Grand Committee')) {
      type = 'Grand Committee';
    }
    else if (overview.Location?.includes('Lords Chamber')) {
      type = 'Lords Chamber';
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
    const { Navigator = [], Overview = {}, Items = [], stats = {} } = debateDetails;
    const parent = Navigator[Navigator.length - 2] || {};
    
    // Find the debate's Timecode from Navigator
    const debateNode = Navigator.find(n => n.ExternalId === Overview.ExtId);
    const startTime = debateNode?.Timecode || null;

    // Validate required fields
    if (!Overview.ExtId || !Overview.Title || !Overview.Date) {
      throw new Error('Missing required fields in Overview');
    }

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

    // Filter out undefined values
    const cleanAiFields = Object.entries(aiFields)
      .reduce((acc, [key, value]) => {
        if (value !== undefined) {
          acc[key] = value;
        }
        return acc;
      }, {});

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
        debateDetails.summary?.summary
      ].join('\n'),
      ai_overview: debateDetails.summary?.overview || '',
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
      
      ai_question: debateDetails.questions?.question?.text || '',
      ai_question_topic: debateDetails.questions?.question?.topic || '',
      ai_question_subtopics: debateDetails.questions?.question?.subtopics || [],
      ai_question_ayes: 0,
      ai_question_noes: 0,
      ...cleanAiFields
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