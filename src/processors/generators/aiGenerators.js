import { openai } from '../../services/openai.js';
import { zodResponseFormat } from 'openai/helpers/zod';
import logger from '../../utils/logger.js';
import { 
  questionPrompts, 
  topicDefinitions 
} from '../../prompts/debatePrompts.js';
import {
  SummarySchemaLong,
  SummarySchemaShort,
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

export async function generateSummary(context, typePrompt, debateType) {
  // Calculate appropriate token length based on context length
  const contextWords = context.split(/\s+/).length;
  const SHORT_DEBATE_THRESHOLD = 800;
  
  if (contextWords <= SHORT_DEBATE_THRESHOLD) {
    console.log('Short debate detected, generating overview only:', {
      contextWords,
      threshold: SHORT_DEBATE_THRESHOLD
    });

    const response = await openai.beta.chat.completions.parse({
      model: "gpt-4o",
      messages: [{ 
        role: "user", 
        content: `You're an expert UK parliamentary analyst who provides clear detailed analyses to busy parliamentarians. Provide a comprehensive analysis of this ${debateType} proceeding.

Context: ${context}

${typePrompt}

Guidelines:
- Focus on the specific format and purpose of this type of proceeding
- Highlight the most significant outcomes or decisions
- Note any ministerial commitments or policy implications
- Identify key participants and their main contributions
- Maintain parliamentary context while being accessible
- Consider the broader political implications

You must return:
- title: A snappy, politically-neutral title in the style of the Financial Times, that reflects the specific type of proceeding
- overview: A well-structured overview that captures key points and their significance
- tone: The overall tone (neutral/contentious/collaborative)

Remember this is a ${debateType} - structure your analysis accordingly.` 
      }],
      temperature: 0.4,
      max_tokens: 250,
      response_format: zodResponseFormat(SummarySchemaShort, 'summary')
    });
    
    return {
      ...response.choices[0].message.parsed,
      summary: response.choices[0].message.parsed.overview
    };
  }
  
  // For longer debates, use the original scaling formula
  const baseTokens = 650;
  const scalingFactor = 0.25; // 1/4 token per word
  const maxTokens = 3000;
  
  const calculatedTokens = Math.min(
    maxTokens,
    Math.max(
      baseTokens,
      baseTokens + Math.floor(contextWords * scalingFactor)
    )
  );

  logger.debug('Calculated summary tokens for full debate:', {
    contextWords,
    calculatedTokens,
    scaling: `${scalingFactor} tokens per word`
  });

  const prompt = `You're an expert UK parliamentary analyst who provides clear detailed analyses to busy parliamentarians. Provide a comprehensive analysis of this ${debateType} proceeding.
  
Context: ${context}
${typePrompt}

In your analysis, highlight:
1. Key points brought up by speakers
   - Main arguments and counterarguments
   - Evidence and data
   - Cross-party positions
2. Notable outcomes
   - Decisions reached
   - Commitments made
   - Actions promised
   - Next steps identified
3. Anything else significant or important to know about this proceeding

You must return:
- title: A snappy, politically-neutral title in the style of the Financial Times, that reflects this type of proceeding
- overview: A clear, concise overview highlighting key details in 2-3 sentences.
- summary: A structured analysis with an emphasis on the most important elements listed above
- tone: The overall tone (neutral/contentious/collaborative)

Note the user is an expert in this type of proceeding - do not repeat basic context.

Remember this is a ${debateType} proceeding - maintain appropriate context and focus.`;

  try {
    const response = await openai.beta.chat.completions.parse({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: calculatedTokens,
      response_format: zodResponseFormat(SummarySchemaLong, 'summary')
    });

    return response.choices[0].message.parsed;
  } catch (error) {
    logger.error('Failed to generate summary:', {
      error: error.message,
      contextWords,
      calculatedTokens
    });
    throw error;
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
2. The main topic category from these options only:
   - Environment and Natural Resources
   - Healthcare and Social Welfare
   - Economy, Business, and Infrastructure
   - Science, Technology, and Innovation
   - Legal Affairs and Public Safety
   - International Relations and Diplomacy
   - Parliamentary Affairs and Governance
   - Education, Culture, and Society
3. A two-sentence explanation of the significance and context of the division
4. Key arguments for and against (1 sentence each)

Debate Title: ${debate.Overview.Title || 'No Title'}
Debate Context:
${debateText}

Divisions:
${divisions.map((division, index) => `
Division ${index + 1}:
- Text before vote: ${division.text_before_vote || 'Not available'}
- Result: Ayes: ${division.ayes_count || 0}, Noes: ${division.noes_count || 0}
`).join('\n')}`
      }],
      response_format: zodResponseFormat(DivisionQuestionSchema, 'questions')
    });

    // Get the AI generated content and ensure it matches our schema
    const aiQuestions = response.choices[0].message.parsed.questions || [];

    // Map the AI responses back to the original divisions using array index
    return divisions.map((division, index) => {
      const aiContent = aiQuestions[index] || {};
      return {
        external_id: division.external_id,
        debate_section_ext_id: division.debate_section_ext_id,
        division_number: division.division_number,
        ai_question: aiContent.question_text,
        ai_topic: aiContent.topic,
        ai_context: aiContent.explanation,
        ai_key_arguments: {
          for: aiContent.arguments?.for,
          against: aiContent.arguments?.against
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