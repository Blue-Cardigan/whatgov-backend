import { openai } from '../services/openai.js';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import logger from '../utils/logger.js';
import us2gbTranslations from './us2gbbig.json';

// Define schemas for each type of response
const SummarySchema = z.object({
  title: z.string(),
  sentence1: z.string(),
  sentence2: z.string(),
  sentence3: z.string(),
  tone: z.enum(['neutral', 'contentious', 'collaborative']),
  wordCount: z.number()
});

const QuestionSchema = z.object({
  text: z.string(),
  topic: z.enum([
    'Environment and Natural Resources',
    'Healthcare and Social Welfare',
    'Economy, Business, and Infrastructure',
    'Science, Technology, and Innovation',
    'Legal Affairs and Public Safety',
    'International Relations and Diplomacy',
    'Parliamentary Affairs and Governance',
    'Education, Culture, and Society'
  ]),
});

const QuestionsSchema = z.object({
  questions: z.array(QuestionSchema)
});

const TopicSchema = z.object({
  topics: z.array(z.object({
    name: z.enum([
      'Environment and Natural Resources',
      'Healthcare and Social Welfare',
      'Economy, Business, and Infrastructure',
      'Science, Technology, and Innovation',
      'Legal Affairs and Public Safety',
      'International Relations and Diplomacy',
      'Parliamentary Affairs and Governance',
      'Education, Culture, and Society'
    ]),
    subtopics: z.array(z.string()),
    frequency: z.number(),
    speakers: z.array(z.string())
  }))
});

const KeyPointSchema = z.object({
  keyPoints: z.array(z.object({
    point: z.string(),
    speaker: z.string(),
    support: z.array(z.string()),
    opposition: z.array(z.string())
  }))
});

// Add new schema for division questions
const DivisionQuestionSchema = z.object({
  questions: z.array(z.object({
    division_id: z.number(),
    question: z.string(),
    topic: z.enum([
      'Environment and Natural Resources',
      'Healthcare and Social Welfare',
      'Economy, Business, and Infrastructure',
      'Science, Technology, and Innovation',
      'Legal Affairs and Public Safety',
      'International Relations and Diplomacy',
      'Parliamentary Affairs and Governance',
      'Education, Culture, and Society'
    ]),
    context: z.string(),
    key_arguments: z.object({
      for: z.string(),
      against: z.string()
    })
  }))
});

// Add new schema after existing schemas
const CommentThreadSchema = z.object({
  comments: z.array(z.object({
    id: z.string(),
    parent_id: z.string().nullable(),
    author: z.string(),
    party: z.string().nullable(),
    content: z.string(),
    votes: z.object({
      upvotes: z.number(),
      upvotes_speakers: z.array(z.string()),
      downvotes: z.number(),
      downvotes_speakers: z.array(z.string())
    }),
    tags: z.array(z.string())
  }))
});

// Add new generation function before processAIContent
async function generateCommentThread(text, debateId) {
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
      - Identify support and opposition to each point and provide up/downvotes accordingly
      - Preserve the speaker's full first and last name
      - Preserve the full first and last name of supporters and opponents
      - Include relevant hashtag-style tags if relevant to the comment
      - Balance entertaining social media-style language with complete information`
    }, {
      role: "user",
      content: text
    }],
    response_format: zodResponseFormat(CommentThreadSchema, 'comment_thread')
  });

  // Transform the comments to include proper IDs
  return {
    ...response.choices[0].message.parsed,
    comments: response.choices[0].message.parsed.comments.map((comment, index) => ({
      ...comment,
      id: generateCommentId(index + 1, comment.parent_id)
    }))
  };
}

export async function processAIContent(debate, memberDetails, divisions = null, debateType) {
  try {
    const processedItems = processDebateItems(debate.Items, memberDetails);
    const debateText = formatDebateContext(debate.Overview, processedItems);
    const location = debate.Overview?.Location;

    // Get the type-specific prompt first
    const typeSpecificPrompt = getTypeSpecificPrompt(debateType, location);

    logger.debug('Processing AI content', {
      debateId: debate.Overview?.Id,
      textLength: debateText.length,
      itemCount: processedItems.length,
      debateType,
      location
    });

    try {
      // Generate all AI responses concurrently
      const [summary, questions, topics, keyPoints, divisionQuestions, commentThread] = await Promise.all([
        generateSummary(debateText, typeSpecificPrompt).then(res => {
          return res.choices[0].message.parsed;
        }),
        generateQuestions(debateText, typeSpecificPrompt).then(res => {
          return res.choices[0].message.parsed;
        }),
        extractTopics(debateText).then(res => {
          return res.choices[0].message.parsed;
        }),
        extractKeyPoints(debateText).then(res => {
          return res.choices[0].message.parsed;
        }),
        divisions ? generateDivisionQuestions(debate, divisions, memberDetails).then(res => {
          return res;
        }) : [],
        generateCommentThread(debateText, debate.Overview?.Id).then(res => {
          return res;
        })
      ]);

      // Handle potential refusals
      if (summary.refusal || questions.refusal || topics.refusal || keyPoints.refusal) {
        logger.warn('AI refused to process some content', {
          debateId: debate.Overview?.Id,
          refusals: {
            summary: !!summary.refusal,
            questions: !!questions.refusal,
            topics: !!topics.refusal,
            keyPoints: !!keyPoints.refusal
          }
        });
        throw new Error('AI refused to process debate content');
      }

      logger.debug('Starting translations', {
        debateId: debate.Overview?.Id
      });

      // Translate the AI outputs to British English
      const translatedSummary = {
        ...summary,
        title: handleBritishTranslation(summary.title),
        summary: [
          handleBritishTranslation(summary.sentence1),
          handleBritishTranslation(summary.sentence2),
          handleBritishTranslation(summary.sentence3)
        ].join('\n')
      };

      const translatedQuestions = {
        questions: questions.questions.map(q => ({
          ...q,
          text: handleBritishTranslation(q.text),
          topic: handleBritishTranslation(q.topic)
        }))
      };

      const translatedKeyPoints = {
        keyPoints: keyPoints.keyPoints.map(kp => ({
          ...kp,
          point: handleBritishTranslation(kp.point)
        }))
      };

      const translatedTopics = {
        topics: topics.topics.map(t => ({
          ...t,
          name: handleBritishTranslation(t.name)
        }))
      };

      logger.debug('Completed translations', {
        debateId: debate.Overview?.Id
      });

      // Format questions into individual fields
      const questionFields = formatQuestionFields(translatedQuestions.questions);

      const result = {
        title: translatedSummary.title,
        summary: translatedSummary.summary,
        tone: translatedSummary.tone.toLowerCase(),
        ...questionFields,
        topics: translatedTopics.topics.map(t => ({
          name: t.name,
          subtopics: t.subtopics.map(st => handleBritishTranslation(st)),
          frequency: t.frequency,
          speakers: t.speakers
        })),
        keyPoints: translatedKeyPoints.keyPoints,
        tags: translatedTopics.topics.flatMap(t => 
          t.subtopics.map(st => handleBritishTranslation(st))
        ),
        division_questions: divisionQuestions.map(q => ({
          division_id: q.division_id,
          question: handleBritishTranslation(q.question),
          topic: q.topic,
          context: handleBritishTranslation(q.context),
          key_arguments: {
            for: handleBritishTranslation(q.key_arguments.for),
            against: handleBritishTranslation(q.key_arguments.against)
          }
        })),
        comment_thread: commentThread.comments.map(comment => ({
          ...comment,
          content: handleBritishTranslation(comment.content),
          tags: comment.tags.map(tag => handleBritishTranslation(tag))
        }))
      };

      logger.debug('Successfully processed AI content', {
        debateId: debate.Overview?.Id,
        contentSections: Object.keys(result),
        questionCount: result.division_questions?.length,
        topicCount: result.topics?.length,
        keyPointCount: result.keyPoints?.length,
        commentCount: result.comment_thread?.comments?.length
      });

      return result;

    } catch (error) {
      logger.error('Failed during AI content generation', {
        debateId: debate.Overview?.Id,
        error: error.message,
        stack: error.stack,
        cause: error.cause
      });
      throw error;
    }

  } catch (error) {
    logger.error('Failed to process AI content', {
      debateId: debate.Overview?.Id,
      error: error.message,
      stack: error.stack,
      cause: error.cause
    });
    throw error;
  }
}

function processDebateItems(items, memberDetails) {
  const processed = [];
  let currentGroup = null;

  items.forEach(item => {
    const cleanText = cleanHtmlTags(item.Value);
    const speaker = item.MemberId ? 
      `${(memberDetails.get(item.MemberId)?.DisplayAs) || ''}, ${(memberDetails.get(item.MemberId)?.Party) || ''}, ${item.AttributedTo.split('Member of Parliament for')[1]?.split('(')[0].trim()}` : 
      item.AttributedTo;
    
    if (!currentGroup || currentGroup.speaker !== speaker) {
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

function cleanHtmlTags(text) {
  return text.replace(/<[^>]*>/g, '');
}

function formatDebateContext(overview, processedItems) {
  const context = [
    `Title: ${overview.Title}`,
    `Location: ${overview.Location}`,
    `House: ${overview.Location?.includes('Lords') ? 'House of Lords' : 'House of Commons'}`,
    '\nDebate Transcript:',
    ...processedItems.map(group => 
      `${group.speaker}:\n${group.text.join('\n')}`
    )
  ];
  
  return context.join('\n\n');
}

async function generateSummary(text, typeSpecificPrompt) {
  return await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [{
      role: "system",
      content: `You are an expert in UK parliamentary procedure and translating parliamentary language into concise media-friendly analysis.
      ${typeSpecificPrompt}
      Provide a snappy title and 3 sentence analysis, in the style of a Financial Times article. 
      Highlight points of greatest significance to the public. 
      Begin your analysis without any introductory text; the reader already knows the title and location.`
    }, {
      role: "user",
      content: text
    }],
    response_format: zodResponseFormat(SummarySchema, 'summary')
  });
}

function getTypeSpecificPrompt(debateType, location) {
  // Lords-specific prompts with enhanced focus
  if (location?.includes('Lords Chamber')) {
    return `
      This is a House of Lords Chamber debate.
      Focus on:
      - The constitutional scrutiny role of the Lords
      - Specific amendments and legislative improvements proposed
      - Requests for government clarification or commitments
      Consider the Lords' role as a revising chamber and highlight any significant challenges to government policy.`;
  }
  
  if (location?.includes('Grand Committee')) {
    return `
      This is a House of Lords Grand Committee session.
      Focus on:
      - Detailed line-by-line examination of legislation
      - Technical amendments and their implications
      - Expert insights from peers with relevant experience
      - Areas where further government clarity is sought
      - Potential improvements to be raised in Chamber
      Note that Grand Committee work informs subsequent Chamber stages.`;
  }

  const prompts = {
    'Westminster Hall': `
      This is a Westminster Hall debate - Parliament's second debating chamber.
      Focus on:
      - Specific constituency or policy issues raised by backbenchers
      - The responding minister's commitments or explanations
      - Cross-party support for particular actions
      - Written ministerial responses promised
      Note that while non-binding, these debates often influence departmental policy.`,

    'Prime Minister\'s Questions': `
      This is Prime Minister's Questions (PMQs).
      Focus on:
      - The Leader of the Opposition's six questions and PM's responses
      - Key policy announcements or commitments made
      - Notable backbench questions (especially from PM's own party)
      - Any departure from usual PMQs format
      Note the broader political context of exchanges and any significant shifts in government position.`,

    'Department Questions': `
      This is Departmental Question Time.
      Focus on:
      - Topical and urgent questions added on the day
      - Written questions selected for oral answer
      - Specific commitments made by ministers
      - Follow-up questions from other MPs
      Note any announcements of new policy or changes to existing policy.`,

    'Public Bill Committee': `
      This is a Public Bill Committee.
      Focus on:
      - Clause-by-clause scrutiny of the bill
      - Evidence sessions with external experts (if any)
      - Government and opposition amendments
      - Areas of cross-party agreement/disagreement
      - Technical improvements and clarifications
      Note that this stage shapes the bill's final form.`,

    'Delegated Legislation Committee': `
      This is a Delegated Legislation Committee.
      Focus on:
      - The specific statutory instrument under scrutiny
      - Implementation concerns raised by MPs
      - Cost and impact assessments discussed
      - Consultation responses referenced
      Note that while committees cannot amend SIs, their scrutiny can influence future regulations.`,

    'Opposition Day': `
      This is an Opposition Day debate.
      Focus on:
      - The specific motion proposed by the Opposition
      - Key criticisms of government policy
      - Alternative proposals presented
      - Government defense and any concessions
      - Voting patterns, especially of government backbenchers
      Note these debates' role in holding government to account.`,

    'Urgent Question': `
      This is an Urgent Question (UQ) granted by the Speaker.
      Focus on:
      - The specific issue requiring immediate ministerial response
      - New information revealed in minister's response
      - Follow-up questions from MPs
      - Any commitments made by the minister
      Note UQs' role in immediate parliamentary scrutiny of emerging issues.`,

    'Statement': `
      This is a Ministerial Statement.
      Focus on:
      - New policy announcements or changes
      - Opposition front bench response
      - Backbench concerns raised
      - Specific commitments or clarifications made
      Note any departure from previously stated government position.`
  };

  return prompts[debateType] || `
    This is a House of Commons proceeding.
    Focus on:
    - The specific parliamentary procedure being used
    - Key points of debate or discussion
    - Ministerial responses or commitments
    - Cross-party positions
    - Practical implications for policy or legislation`;
}

async function generateQuestions(text, typeSpecificPrompt) {
  
  return await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [{
      role: "system",
      content: `You are an expert in survey design for the British public.
      
${typeSpecificPrompt}

Generate 3 yes/no questions about this debate. For each question provide:
1. A clear yes/no question that:
   - Is thought-provoking, provocative, and highlights political differences in British politics
   - Reflects this type of parliamentary proceeding
   - Focuses on significant policy implications
   - Uses clear, accessible language
   - Avoids leading or biased language
2. The main topic category it falls under

Format your response as exactly 3 questions, each with:
- text: The yes/no question
- topic: The main topic category`
    }, {
      role: "user",
      content: text
    }],
    response_format: zodResponseFormat(QuestionsSchema, 'questions')
  });
}

async function extractTopics(text) {
  return await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [{
      role: "system",
      content: `You are an expert UK parliamentary analyst. Categorize the debate content into the following main topics only:

- Environment and Natural Resources
- Healthcare and Social Welfare
- Economy, Business, and Infrastructure
- Science, Technology, and Innovation
- Legal Affairs and Public Safety
- International Relations and Diplomacy
- Parliamentary Affairs and Governance
- Education, Culture, and Society

For each identified topic:
1. Include frequency of discussion
2. List the speakers who discussed it
3. Identify distinct subtopics within each main topic. Ensure these do not overlap, and are not subsets of each other.

Select only the most relevant main topics - not all topics need to be used.`
    }, {
      role: "user",
      content: text
    }],
    response_format: zodResponseFormat(TopicSchema, 'topics')
  });
}

async function extractKeyPoints(text) {
  return await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [{
      role: "system",
      content: `You are an expert UK parliamentary analyst. 
      Identify the key points from this debate and the speakers who made them. 
      Phrase the points as though they were made by the speaker themselves.

      Identify other speakers who supported or opposed each point.`
    }, {
      role: "user",
      content: text
    }],
    response_format: zodResponseFormat(KeyPointSchema, 'keyPoints')
  });
}

// Helper function to format questions (moved from inline)
function formatQuestionFields(questions) {
  try {
    const questionFields = {};
    questions.forEach((q, index) => {
      const num = index + 1;
      questionFields[`ai_question_${num}`] = q.text;
      questionFields[`ai_question_${num}_topic`] = q.topic;
      questionFields[`ai_question_${num}_ayes`] = 0;
      questionFields[`ai_question_${num}_noes`] = 0;
    });

    logger.debug('Formatted question fields', {
      questionCount: questions.length,
      fieldCount: Object.keys(questionFields).length
    });

    return questionFields;
  } catch (error) {
    logger.error('Failed to format question fields', {
      error: error.message,
      stack: error.stack,
      questionCount: questions?.length
    });
    throw error;
  }
}

// Add new helper function to handle translations
function handleBritishTranslation(text) {
  try {
    if (!text) return text;
    
    let translatedText = text;
    for (const [american, british] of Object.entries(us2gbTranslations)) {
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

async function generateDivisionQuestions(debate, divisions, memberDetails) {
  if (!divisions?.length) {
    logger.debug('No divisions to process for questions', {
      debateId: debate.Overview?.Id
    });
    return [];
  }

  try {
    // Process debate text for context
    const processedItems = processDebateItems(debate.Items, memberDetails);
    const debateText = formatDebateContext(debate.Overview, processedItems);

    logger.debug('Preparing division questions prompt', {
      debateId: debate.Overview?.Id,
      divisionCount: divisions.length,
      textLength: debateText.length
    });

    const prompt = `
You are an expert UK parliamentary analyst. Analyze these divisions that occurred during the debate.

For each division above, provide:
1. The division_id as shown
2. A clear yes/no question (max 20 words) that MPs were voting on
3. The main topic category it falls under
4. A two-sentence explanation of the significance and context of the division
5. Key arguments for and against

Ensure each response includes the correct division_id to match with the original division.

Debate Title: ${debate.Overview.Title}
Debate Context:
${debateText}

Divisions:
${divisions.map(div => `
Division ${div.division_number || div.Id}:
- Division ID: ${div.Id || div.division_id}
- Result: Ayes: ${div.ayes_count}, Noes: ${div.noes_count}
`).join('\n')}`;

    const response = await openai.beta.chat.completions.parse({
      model: "gpt-4o",
      messages: [{
        role: "system",
        content: "You are an expert in UK parliamentary procedure who specializes in making complex votes accessible to the public."
      }, {
        role: "user",
        content: prompt
      }],
      response_format: zodResponseFormat(DivisionQuestionSchema, 'division_questions')
    });

    // Validate that we got responses for all divisions
    const questions = response.choices[0].message.parsed.questions;
    const missingDivisions = divisions.filter(div => 
      !questions.find(q => q.division_id === (div.Id || div.division_id))
    );

    if (missingDivisions.length > 0) {
      logger.warn('Some divisions missing from AI response', {
        debateId: debate.Overview?.Id,
        missingDivisions: missingDivisions.map(d => d.Id || d.division_id)
      });
    }

    return questions;
  } catch (error) {
    logger.error('Failed to generate division questions:', {
      error: error.message,
      stack: error.stack,
      cause: error.cause,
      debateId: debate.Overview?.Id,
      divisionCount: divisions?.length,
      divisions: divisions?.map(d => ({
        id: d.Id || d.division_id,
        number: d.division_number,
        hasTextBefore: !!d.text_before_vote,
        hasTextAfter: !!d.text_after_vote
      }))
    });
    return [];
  }
}