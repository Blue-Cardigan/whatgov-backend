import { openai } from '../services/openai.js';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import translator from 'american-british-english-translator';
import logger from '../utils/logger.js';

// Define schemas for each type of response
const SummarySchema = z.object({
  title: z.string(),
  summary: z.string(),
  tone: z.enum(['neutral', 'contentious', 'collaborative']),
  wordCount: z.number()
});

const QuestionSchema = z.object({
  text: z.string(),
  topic: z.string()
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
      content: `You are an expert in transforming parliamentary debates into engaging social media-style disagreements.
      Convert this debate into a threaded comment structure where:
      - Each major point becomes a top-level comment (use index numbers starting from 1)
      - Responses and counterpoints become replies (use parent's index followed by reply number)
      - Include relevant hashtag-style tags if relevant to the comment
      - Provide up/downvotes corresponding to the engagement of other speakers
      - Preserve the speaker's full name
      - For each comment, include its index number in the sequence`
    }, {
      role: "user",
      content: text
    }],
    response_format: zodResponseFormat(CommentThreadSchema, 'comment_thread')
  });

  // Transform the comments to include proper IDs
  console.log(response.choices[0].message.parsed);
  return {
    ...response.choices[0].message.parsed,
    comments: response.choices[0].message.parsed.comments.map((comment, index) => ({
      ...comment,
      id: generateCommentId(index + 1, comment.parent_id)
    }))
  };
}

export async function processAIContent(debate, memberDetails, divisions = null) {
  try {
    // Process and clean debate text
    const processedItems = processDebateItems(debate.Items, memberDetails);
    const debateText = formatDebateContext(debate.Overview, processedItems);

    logger.debug('Prepared debate text for AI processing', {
      debateId: debate.Overview?.Id,
      textLength: debateText.length,
      itemCount: processedItems.length
    });

    // Generate all AI responses concurrently
    try {
      const [summary, questions, topics, keyPoints, divisionQuestions, commentThread] = await Promise.all([
        generateSummary(debateText).then(res => {
          logger.debug('Generated summary', { 
            debateId: debate.Overview?.Id,
            success: !!res?.choices?.[0]?.message?.parsed 
          });
          return res.choices[0].message.parsed;
        }),
        generateQuestions(debateText).then(res => {
          logger.debug('Generated questions', { 
            debateId: debate.Overview?.Id,
            count: res?.choices?.[0]?.message?.parsed?.questions?.length 
          });
          return res.choices[0].message.parsed;
        }),
        extractTopics(debateText).then(res => {
          logger.debug('Extracted topics', { 
            debateId: debate.Overview?.Id,
            count: res?.choices?.[0]?.message?.parsed?.topics?.length 
          });
          return res.choices[0].message.parsed;
        }),
        extractKeyPoints(debateText).then(res => {
          logger.debug('Extracted key points', { 
            debateId: debate.Overview?.Id,
            count: res?.choices?.[0]?.message?.parsed?.keyPoints?.length 
          });
          return res.choices[0].message.parsed;
        }),
        divisions ? generateDivisionQuestions(debate, divisions, memberDetails).then(res => {
          logger.debug('Generated division questions', { 
            debateId: debate.Overview?.Id,
            divisionCount: divisions.length,
            questionCount: res?.length 
          });
          return res;
        }) : [],
        generateCommentThread(debateText, debate.Overview?.Id).then(res => {
          logger.debug('Generated comment thread', { 
            debateId: debate.Overview?.Id,
            commentCount: res?.comments?.length 
          });
          console.log(res);
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

      // Add translation options
      const translationOptions = {
        british: true,
        spelling: true
      };

      logger.debug('Starting translations', {
        debateId: debate.Overview?.Id
      });

      // Translate the AI outputs to British English
      const translatedSummary = {
        ...summary,
        title: handleBritishTranslation(summary.title, translationOptions),
        summary: handleBritishTranslation(summary.summary, translationOptions)
      };

      const translatedQuestions = {
        questions: questions.questions.map(q => ({
          ...q,
          text: handleBritishTranslation(q.text, translationOptions),
          topic: handleBritishTranslation(q.topic, translationOptions)
        }))
      };

      const translatedKeyPoints = {
        keyPoints: keyPoints.keyPoints.map(kp => ({
          ...kp,
          point: handleBritishTranslation(kp.point, translationOptions)
        }))
      };

      const translatedTopics = {
        topics: topics.topics.map(t => ({
          ...t,
          name: handleBritishTranslation(t.name, translationOptions)
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
          subtopics: t.subtopics.map(st => handleBritishTranslation(st, translationOptions)),
          frequency: t.frequency,
          speakers: t.speakers
        })),
        keyPoints: translatedKeyPoints.keyPoints,
        tags: translatedTopics.topics.flatMap(t => t.subtopics.map(st => handleBritishTranslation(st, translationOptions))),
        division_questions: divisionQuestions.map(q => ({
          division_id: q.division_id,
          question: handleBritishTranslation(q.question, translationOptions),
          topic: q.topic,
          context: handleBritishTranslation(q.context, translationOptions),
          key_arguments: {
            for: handleBritishTranslation(q.key_arguments.for, translationOptions),
            against: handleBritishTranslation(q.key_arguments.against, translationOptions)
          }
        })),
        comment_thread: commentThread.comments.map(comment => ({
          ...comment,
          content: handleBritishTranslation(comment.content, translationOptions),
          tags: comment.tags.map(tag => handleBritishTranslation(tag, translationOptions))
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

      console.log(result.comment_thread);

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
      `${item.AttributedTo} ${(memberDetails.get(item.MemberId)?.Party) || ''}` : 
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
    '\nDebate Transcript:',
    ...processedItems.map(group => 
      `${group.speaker}:\n${group.text.join('\n')}`
    )
  ];
  
  return context.join('\n\n');
}

async function generateSummary(text) {
  return await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [{
      role: "system",
      content: `You are an expert in UK parliamentary procedure and translating parliamentary language into concise media-friendly analysis.
      Provide a snappy title and 3 sentence analysis for this parliamentary debate, in the style of a Financial Times article. 
      Highlight points of greatest significance to the public. 
      Begin your analysis without any introductory text; the reader already knows the title and location.
      Also assess the overall tone of the debate.`
    }, {
      role: "user",
      content: text
    }],
    response_format: zodResponseFormat(SummarySchema, 'summary')
  });
}

async function generateQuestions(text) {
  return await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [{
      role: "system",
      content: "You are an expert in UK parliamentary procedure and survey research. Provide 3 yes/no questions to gauge reader perspectives on key issues from this debate. Each question should be thought-provoking and relate to a specific topic of contention."
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
function handleBritishTranslation(text, options) {
  try {
    const analysis = translator.translate(text, options);
    let translatedText = text;
    
    if (analysis && analysis['1']) {
      logger.debug('Translation analysis found changes', {
        originalText: text.substring(0, 50),
        changeCount: analysis['1'].length
      });

      analysis['1'].forEach(item => {
        const americanWord = Object.keys(item)[0];
        const details = item[americanWord];

        switch (details.issue) {
          case 'American English Spelling':
            const britishSpelling = details.details;
            translatedText = translatedText.replace(
              new RegExp(`\\b${americanWord}\\b`, 'gi'), 
              britishSpelling
            );
            break;
        }
      });
    }

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

Debate Title: ${debate.Overview.Title}
Debate Context:
${debateText}

Divisions:
${divisions.map(div => `
Division ${div.division_number || div.Id}:
- Division ID: ${div.Id || div.division_id}
- Text before vote: "${div.text_before_vote}"
- Text after vote: "${div.text_after_vote}"
- Result: Ayes: ${div.ayes_count}, Noes: ${div.noes_count}
`).join('\n')}

For each division above, provide:
1. The division_id as shown
2. A clear yes/no question (max 20 words) that MPs were voting on
3. The main topic category it falls under
4. A two-sentence explanation of the significance and context of the division
5. Key arguments for and against

Ensure each response includes the correct division_id to match with the original division.`;

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