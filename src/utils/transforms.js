export function validateDebateContent(debateDetails) {
  try {
    // Validate input
    if (!debateDetails?.Overview) {
    throw new Error('Missing required debate overview data');
    }

    const { Items = [], } = debateDetails;
    
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
    } else {
        return 'valid';
    }
  } catch (error) {
    console.error('Filter debate content error:', error);
    return null;
 }
}

export function transformDebate(debateDetails) {
  try {
    // Find parent section in navigator
    const { Navigator = [], Overview = {}, Items = [] } = debateDetails;
    const parent = Navigator[Navigator.length - 2] || {};
    
    // Validate required fields
    if (!Overview.ExtId || !Overview.Title || !Overview.Date) {
      throw new Error('Missing required fields in Overview');
    }
    
    // Get cleaned search text
    const searchText = (Items || [])
      .filter(item => item?.ItemType === 'Contribution')
      .map(item => item?.Value || '')
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .trim();
    
    // Get unique speaker count from contributions
    const uniqueSpeakers = new Set(
      Items
        .filter(item => item?.ItemType === 'Contribution' && item?.MemberId)
        .map(item => item.MemberId)
    );

    return {
      ext_id: Overview.ExtId,
      title: Overview.Title || '',
      date: Overview.Date,
      
      // Basic metadata
      type: Overview.HRSTag || '',
      house: Overview.House || '',
      location: Overview.Location || '',

      ai_title: debateDetails.title || '',
      ai_summary: debateDetails.summary || '',
      ai_tone: (debateDetails.tone || 'neutral').toLowerCase(),
      ai_topics: Array.isArray(debateDetails.topics) ? debateDetails.topics : [],
      ai_tags: Array.isArray(debateDetails.tags) ? debateDetails.tags : [],
      ai_key_points: Array.isArray(debateDetails.keyPoints) ? debateDetails.keyPoints : [],
      
      speaker_count: uniqueSpeakers.size,
      contribution_count: (Items || []).filter(item => item?.ItemType === 'Contribution').length,
      party_count: debateDetails.partyCount || {},
      
      // Navigation
      parent_ext_id: parent.ExternalId || '',
      parent_title: parent.Title || '',
      prev_ext_id: Overview.PreviousDebateExtId || null,
      next_ext_id: Overview.NextDebateExtId || null,
      
      // Search optimization
      search_text: searchText,
      
      // Individual question fields
      ai_question_1: debateDetails.ai_question_1 || '',
      ai_question_1_topic: debateDetails.ai_question_1_topic || '',
      ai_question_1_ayes: 0,
      ai_question_1_noes: 0,
      
      ai_question_2: debateDetails.ai_question_2 || '',
      ai_question_2_topic: debateDetails.ai_question_2_topic || '',
      ai_question_2_ayes: 0,
      ai_question_2_noes: 0,
      
      ai_question_3: debateDetails.ai_question_3 || '',
      ai_question_3_topic: debateDetails.ai_question_3_topic || '',
      ai_question_3_ayes: 0,
      ai_question_3_noes: 0,
    };
  } catch (error) {
    // Add detailed error information
    console.error('Transform debate error:', {
      error: error.message,
      overview: debateDetails?.Overview,
      items: debateDetails?.Items?.length
    });
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