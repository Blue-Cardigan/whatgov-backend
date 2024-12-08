import { openai } from '../../services/openai.js';
import { zodResponseFormat } from 'openai/helpers/zod';
import logger from '../../utils/logger.js';
import { 
  summaryPrompts, 
  questionPrompts, 
  topicDefinitions 
} from '../../prompts/debatePrompts.js';
import {
  SummarySchema,
  QuestionsSchema,
  TopicSchema,
  KeyPointSchema,
  DivisionQuestionSchema,
  CommentThreadSchema
} from '../../schemas/debateSchemas.js';
import { formatDebateContext, processDebateItems } from '../../utils/debateUtils.js';

function cleanSpeakerName(speakerName) {
  if (!speakerName) return '';
  
  // Handle multiple speakers
  if (speakerName.includes(',')) {
    return speakerName.split(',')
      .map(name => cleanSpeakerName(name.trim()))
      .filter(Boolean)
      .join(', ');
  }

  // Remove common titles and prefixes
  const titlesToRemove = [
    'MP for', 'Member for', 'Member of Parliament for',
    'Sir', 'Dame', 'Dr', 'Dr.', 'Mr', 'Mr.', 'Mrs', 'Mrs.', 'Ms', 'Ms.',
    'Hon.', 'Right Hon.'
  ];

  // Remove party affiliations
  const partyAffiliations = [
    'Conservative', 'Labour', 'Liberal Democrat', 'SNP', 
    'Democratic Unionist Party', 'Green Party', 'Sinn Féin'
  ];

  let cleanedName = speakerName;

  // Remove titles
  titlesToRemove.forEach(title => {
    const regex = new RegExp(`^${title}\\s+`, 'i');
    cleanedName = cleanedName.replace(regex, '');
  });

  // Remove party affiliations
  partyAffiliations.forEach(party => {
    const regex = new RegExp(`\\s*${party}\\s*$`, 'i');
    cleanedName = cleanedName.replace(regex, '');
  });

  // Clean up any remaining whitespace
  cleanedName = cleanedName.trim();

  return cleanedName || speakerName; // Return original if cleaned version is empty
}

export async function generateSummary(text, typeSpecificPrompt) {
  const defaultPrompt = `Analyze this parliamentary proceeding.
Focus on key policy points, cross-party positions, and practical implications.
Highlight significant outcomes and any ministerial commitments made.`;

  try {
    const response = await openai.beta.chat.completions.parse({
      model: "gpt-4o",
      messages: [{
        role: "system",
        content: `You are an expert in UK parliamentary procedure and debate analysis.
${summaryPrompts[typeSpecificPrompt] || defaultPrompt}
Provide:
- A snappy, newspaper-style, politically neutral title (max 10 words)
- Three concise, analytical sentences in Financial Times style
- Tone assessment (must be one of: neutral, contentious, collaborative)

Remember: Focus on analysis - readers know the context.
Always include a tone assessment based on:
- neutral: balanced discussion, general agreement
- contentious: strong disagreement, heated exchanges
- collaborative: cross-party cooperation, constructive debate`
      }, {
        role: "user",
        content: text
      }],
      response_format: zodResponseFormat(SummarySchema, 'summary')
    });

    // Validate and normalize tone
    const validTones = ['neutral', 'contentious', 'collaborative'];
    let normalizedTone = response?.choices[0].message.parsed.tone?.toLowerCase() || 'neutral';
    
    if (!validTones.includes(normalizedTone)) {
      logger.warn('Invalid tone received, defaulting to neutral', {
        receivedTone: normalizedTone,
        title: response?.choices[0].message.parsed.title
      });
      normalizedTone = 'neutral';
    }

    return {
      ...response.choices[0].message.parsed,
      tone: normalizedTone
    };

  } catch (error) {
    logger.error('Failed to generate summary:', {
      error: error.message,
      stack: error.stack
    });
    return {
      title: 'Summary Unavailable',
      sentence1: 'Unable to generate summary.',
      sentence2: 'Please refer to original debate text.',
      sentence3: 'Technical error occurred during processing.',
      tone: 'neutral',
      wordCount: 0
    };
  }
}

export async function generateQuestions(text, type) {
  try {
    const defaultPrompt = `Generate a question about the key policy implications or decisions discussed.`;

    const response = await openai.beta.chat.completions.parse({
      model: "gpt-4o",
      messages: [{
        role: "system",
        content: `You are an expert in survey design for the British public.
        
${questionPrompts[type] || defaultPrompt}

Generate a yes/no question about this debate that:
- Is thought-provoking, provocative, and highlights political differences in British politics
- Is accessible to a person with no specialist knowledge of this topic
- Is phrased concisely
- Reflects this type of parliamentary proceeding
- Focuses on the most significant policy implication
- Uses clear, accessible language
- Avoids leading or biased language

You must return:
- A question text string
- A topic from the predefined list
- One or more subtopics that MUST be chosen from the predefined subtopics for that topic

Available topics and their required subtopics:
${Object.entries(topicDefinitions).map(([topic, subtopics]) => 
  `${topic}:\n${subtopics.map(st => `- ${st}`).join('\n')}`
).join('\n\n')}

Important:
- Choose only relevant subtopics from the list above
- Do not create new subtopics or modify existing ones
- If no exact match exists, choose the closest matching subtopic from the list
- Include at least one valid subtopic from the chosen topic's list`
      }, {
        role: "user",
        content: text
      }],
      response_format: zodResponseFormat(QuestionsSchema, 'questions')
    });

    // Handle potential undefined or invalid responses
    if (!response?.choices?.[0]?.message?.parsed?.question) {
      logger.warn('No question generated, returning default empty response');
      return {
        question: {
          text: '',
          topic: Object.keys(topicDefinitions)[0],
          subtopics: [topicDefinitions[Object.keys(topicDefinitions)[0]][0]]
        }
      };
    }

    const question = response.choices[0].message.parsed.question;
    
    // Validate that the topic exists
    if (!topicDefinitions[question.topic]) {
      logger.warn('Invalid topic received, using first available topic', {
        invalidTopic: question.topic,
        availableTopics: Object.keys(topicDefinitions)
      });
      question.topic = Object.keys(topicDefinitions)[0];
      question.subtopics = [topicDefinitions[question.topic][0]];
      return { question };
    }

    // Validate subtopics and filter out invalid ones
    const validSubtopics = question.subtopics.filter(subtopic => 
      topicDefinitions[question.topic].includes(subtopic)
    );

    if (validSubtopics.length === 0) {
      logger.warn('No valid subtopics found, using default subtopic', {
        topic: question.topic,
        invalidSubtopics: question.subtopics,
        availableSubtopics: topicDefinitions[question.topic]
      });
      validSubtopics.push(topicDefinitions[question.topic][0]);
    }

    // Return validated question
    return {
      question: {
        ...question,
        subtopics: validSubtopics
      }
    };

  } catch (error) {
    logger.error('Failed to generate questions:', {
      error: error.message,
      stack: error.stack
    });
    // Return a safe default response
    return {
      question: {
        text: '',
        topic: Object.keys(topicDefinitions)[0],
        subtopics: [topicDefinitions[Object.keys(topicDefinitions)[0]][0]]
      }
    };
  }
}

export async function extractTopics(text) {
  try {
    const response = await openai.beta.chat.completions.parse({
      model: "gpt-4o",
      messages: [{
        role: "system",
        content: `You are an expert UK parliamentary analyst. Analyze each speaker's contributions and categorize them into main topics and subtopics.

For each identified topic:
1. Include frequency of discussion for each speaker (as a number 1-100)
2. List the speakers who discussed it, with their complete details:
   - Full name as provided
   - Party affiliation (if mentioned)
   - Constituency (if mentioned)
   - Member ID (if provided in the original text)
   And their individual:
   - Subtopics from the predefined list
   - Frequency of discussion for each subtopic (1-100)
4. Only select subtopics from the predefined list that were actually discussed
5. Select only the most relevant main topics - not all topics need to be used
6. Ensure accurate speaker attribution with complete details

Available topics and their required subtopics:
${Object.entries(topicDefinitions).map(([topic, subtopics]) => 
  `${topic}:\n${subtopics.map(st => `- ${st}`).join('\n')}`
).join('\n\n')}
`
      }, {
        role: "user",
        content: text
      }],
      response_format: zodResponseFormat(TopicSchema, 'topics')
    });

    // Post-process speaker details in topics
    const validatedTopics = response.choices[0].message.parsed.topics.map(topic => ({
      ...topic,
      speakers: topic.speakers.map(speaker => ({
        name: cleanSpeakerName(speaker.name),
        memberId: speaker.memberId || null,
        party: speaker.party || null,
        constituency: speaker.constituency || null,
        subtopics: speaker.subtopics.filter(subtopic => 
          topicDefinitions[topic.name]?.includes(subtopic)
        ),
        frequency: speaker.frequency
      }))
    }));

    return validatedTopics;

  } catch (error) {
    logger.error('Failed to extract topics:', {
      error: error.message,
      stack: error.stack
    });
    return [];
  }
}

export async function extractKeyPoints(text) {
  try {
    const response = await openai.beta.chat.completions.parse({
      model: "gpt-4o",
      messages: [{
        role: "system",
        content: `You are an expert UK parliamentary analyst. 
        Extract and clarify all substantive points made during the debate, maintaining the flow of discussion.
        
        For each point, capture complete speaker details including:
        - Full name as stated in the debate
        - Party affiliation (if mentioned)
        - Constituency (if mentioned)
        - Member ID (if provided in the original text)
        
        For each point:
        - Preserve the important details of the contribution, with clear and concise language
        - Keep the speaker's original intent and tone
        - Include all specific details, facts, figures, and proposals
        - Note any direct responses or rebuttals to previous points
        - Identify any speakers who explicitly agree or disagree (including their full details)
        - Extract 3-5 searchable keywords that capture the main topics
        
        Guidelines:
        - Include ALL substantive points, not just the key ones
        - Maintain the chronological order of the debate
        - Preserve technical details and specific policy proposals
        - Note any procedural or parliamentary process points
        - Include questions asked and answers given
        - Always include complete speaker details for main speaker and any supporting/opposing speakers
        - Keywords should be specific and searchable (e.g., "supporting vulnerable groups", "cost of living", "community benefit funds")
        
        Return each point with:
        - A point string (the clarified statement)
        - Speaker details (name, memberId, party, constituency)
        - Support array (full speaker details of supporters)
        - Opposition array (full speaker details of opponents)
        - Context string (references to previous points being addressed)
        - Keywords array (3-5 relevant search terms)`
      }, {
        role: "user",
        content: text
      }],
      response_format: zodResponseFormat(KeyPointSchema, 'keyPoints')
    });

    // Post-process speaker details
    if (response?.choices?.[0]?.message?.parsed?.keyPoints) {
      response.choices[0].message.parsed.keyPoints = 
        response.choices[0].message.parsed.keyPoints.map(keyPoint => ({
          ...keyPoint,
          speaker: {
            ...keyPoint.speaker,
            name: cleanSpeakerName(keyPoint.speaker.name)
          },
          support: keyPoint.support.map(supporter => ({
            ...supporter,
            name: cleanSpeakerName(supporter.name)
          })),
          opposition: keyPoint.opposition.map(opposer => ({
            ...opposer,
            name: cleanSpeakerName(opposer.name)
          })),
          context: keyPoint.context || null,
          keywords: keyPoint.keywords || []
        }));
    }

    // Handle potential undefined or invalid responses
    if (!response?.choices?.[0]?.message?.parsed?.keyPoints) {
      return { keyPoints: [] };
    }

    return response.choices[0].message.parsed;

  } catch (error) {
    logger.error('Failed to extract points:', {
      error: error.message,
      stack: error.stack
    });
    return { keyPoints: [] };
  }
}

export async function generateCommentThread(text, debateId) {
  const generateCommentId = (index, parentIndex = null) => {
    const prefix = debateId || 'debate';
    return parentIndex === null 
      ? `${prefix}_c${index}` 
      : `${prefix}_c${parentIndex}_r${index}`;
  };

  const response = await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [{
      role: "system",
      content: `You are an expert in transforming parliamentary debates into casual social media-style disagreements.
      Convert this debate into a threaded comment structure where:
      - Each major point becomes a top-level comment (use index numbers starting from 1)
      - Responses and counterpoints become replies (use parent's index followed by reply number)
      - For each speaker, include complete details:
        * Full name as provided
        * Party affiliation (if mentioned)
        * Constituency (if mentioned)
        * Member ID (if provided in the original text)
      - Identify speakers who support and oppose each point with their complete details
      - Ensure every speaker is mentioned at least once with full details
      - Include relevant hashtag-style tags if relevant to the comment
      - Balance entertaining social media-style language with complete information`
    }, {
      role: "user",
      content: text
    }],
    response_format: zodResponseFormat(CommentThreadSchema, 'comment_thread')
  });

  // Post-process the comments to ensure complete speaker details
  return {
    ...response.choices[0].message.parsed,
    comments: response.choices[0].message.parsed.comments.map((comment, index) => ({
      id: generateCommentId(index + 1, comment.parent_id),
      parent_id: comment.parent_id,
      author: {
        name: cleanSpeakerName(comment.author.name),
        memberId: comment.author.memberId || null,
        party: comment.author.party || null,
        constituency: comment.author.constituency || null
      },
      content: comment.content,
      votes: {
        ...comment.votes,
        upvotes_speakers: comment.votes.upvotes_speakers.map(speaker => ({
          name: cleanSpeakerName(speaker.name),
          memberId: speaker.memberId || null,
          party: speaker.party || null,
          constituency: speaker.constituency || null
        })),
        downvotes_speakers: comment.votes.downvotes_speakers.map(speaker => ({
          name: cleanSpeakerName(speaker.name),
          memberId: speaker.memberId || null,
          party: speaker.party || null,
          constituency: speaker.constituency || null
        }))
      },
      tags: comment.tags
    }))
  };
}

export async function generateDivisionQuestions(debate, divisions, memberDetails) {
  try {
    // Safely process items and create debate text
    const processedItems = processDebateItems(debate.Items || [], memberDetails);
    const debateText = formatDebateContext({
      Title: debate.Overview.Title || 'Untitled Debate',
      Location: debate.Overview.Location || 'Unknown Location'
    }, processedItems);

    const response = await openai.beta.chat.completions.parse({
      model: "gpt-4o",
      messages: [{
        role: "system",
        content: "You are an expert in UK parliamentary procedure who specializes in making complex votes accessible to the public."
      }, {
        role: "user",
        content: `
Analyze these divisions that occurred during the debate.

For each division, provide:
1. A clear yes/no question (max 20 words) that MPs were voting on
2. The main topic category it falls under
3. A two-sentence explanation of the significance and context of the division
4. Key arguments for and against

Debate Title: ${debate.Overview.Title || 'Untitled Debate'}
Debate Context:
${debateText}

Divisions:
${divisions.map((div, index) => `
Division ${index + 1}:
- Result: Ayes: ${div.ayes_count || 0}, Noes: ${div.noes_count || 0}
`).join('\n')}`
      }],
      response_format: zodResponseFormat(DivisionQuestionSchema, 'division_questions')
    });

    // Get the AI generated content
    const aiQuestions = response.choices[0].message.parsed.questions || [];

    // Map the AI responses back to the original divisions using array index
    return divisions.map((division, index) => {
      const aiContent = aiQuestions[index] || {};
      return {
        division_id: division.Id,
        external_id: division.ExternalId,
        debate_section_ext_id: division.DebateSectionExtId || debate.Overview.ExtId,
        question_text: aiContent.question_text || 'Question unavailable',
        topic: aiContent.topic || 'other',
        explanation: aiContent.explanation || 'No explanation available',
        arguments: {
          for: aiContent.arguments?.for || [],
          against: aiContent.arguments?.against || []
        }
      };
    });

  } catch (error) {
    logger.error('Failed to generate division questions:', {
      error: error.message,
      stack: error.stack,
      debateId: debate.Overview?.Id,
      debateTitle: debate.Overview?.Title,
      divisionsCount: divisions?.length
    });
    return [];
  }
} 