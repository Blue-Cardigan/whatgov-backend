import { openai } from '../services/openai.js';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import logger from '../utils/logger.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load translations
const us2gbTranslations = JSON.parse(
  readFileSync(join(__dirname, './us2gbbig.json'), 'utf8')
);

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
  question: QuestionSchema
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
      - Ensure every speaker is mentioned at least once
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

      // Add null checks before processing
      if (!questions?.question) {
        logger.warn('Questions response is missing or malformed', {
          debateId: debate.Overview?.Id,
          questions
        });
        questions = { question: { text: '', topic: 'Parliamentary Affairs and Governance' } };
      }

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

      const translatedQuestion = {
        question: {
          ...questions.question,
          text: handleBritishTranslation(questions.question.text),
          topic: handleBritishTranslation(questions.question.topic)
        }
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
      const questionFields = formatQuestionFields(questions.question);

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
    const memberInfo = memberDetails.get(item.MemberId);
    const party = memberInfo?.Party ? `(${memberInfo.Party})` : '';
    const constituency = item.AttributedTo.split('Member of Parliament for')[1]?.split('(')[0].trim();
    
    // Format speaker with clear party affiliation
    const speaker = item.MemberId ? 
      `${memberInfo?.DisplayAs || ''} ${party}${constituency ? `, ${constituency}` : ''}` : 
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
  const summaryPrompts = {
    'Main': `Analyze this main Chamber debate.
Focus on policy implications, cross-party positions, and ministerial commitments.
Highlight any significant shifts in government position or cross-party consensus.`,

    'Debated Bill': `Analyze this bill debate.
Focus on key legislative changes, contentious provisions, and likely impact.
Highlight significant amendments and level of cross-party support.`,

    'Debated Motion': `Analyze this motion debate.
Focus on the specific proposal, voting implications, and party positions.
Highlight whether the motion is binding and its practical consequences.`,

    'Westminster Hall': `Analyze this Westminster Hall debate.
Focus on constituency impacts, ministerial responses, and backbench concerns.
Highlight any commitments or promised actions from ministers.`,

    'Prime Minister\'s Questions': `Analyze this PMQs session.
Focus on key exchanges, significant announcements, and political dynamics.
Highlight any shifts in government position or notable backbench interventions.`,

    'Department Questions': `Analyze this departmental questions session.
Focus on policy announcements, ministerial commitments, and emerging issues.
Highlight any significant revelations or changes in departmental position.`,

    'Delegated Legislation': `Analyze this delegated legislation debate.
Focus on statutory instrument details, implementation concerns, and scrutiny points.
Highlight any technical issues or practical implementation challenges raised.`,

    'General Committees': `Analyze this general committee session.
Focus on detailed scrutiny, expert evidence, and proposed improvements.
Highlight key areas of concern and cross-party agreement/disagreement.`,

    'Urgent Question': `Analyze this urgent question session.
Focus on the immediate issue, ministerial response, and follow-up scrutiny.
Highlight new information revealed and any commitments made.`,

    'Petition': `Analyze this petition debate.
Focus on public concerns raised, government response, and proposed actions.
Highlight level of parliamentary support and likely outcomes.`,

    'Department': `Analyze this departmental session.
Focus on policy implementation, ministerial accountability, and specific commitments.
Highlight any changes in departmental position or new initiatives.`,

    'Business Without Debate': `Analyze this procedural business.
Focus on technical changes, administrative matters, and procedural implications.
Highlight any significant changes to parliamentary operations.`,

    'Opposition Day': `Analyze this Opposition Day debate.
Focus on opposition critique, government defense, and alternative proposals.
Highlight voting patterns and any concessions made.`,

    'Statement': `Analyze this ministerial statement.
Focus on policy announcements, immediate reactions, and implementation plans.
Highlight any shifts from previous positions or new commitments.`,

    'Question': `Analyze this parliamentary question session.
Focus on specific issues raised, quality of answers, and follow-up scrutiny.
Highlight any new information or commitments obtained.`,

    'Bill Procedure': `Analyze this bill procedure debate.
Focus on legislative process, technical amendments, and procedural implications.
Highlight any changes to the bill's progression or handling.`,

    'Public Bill Committees': `Analyze this bill committee session.
Focus on detailed scrutiny, evidence consideration, and proposed amendments.
Highlight areas of consensus and remaining contentious issues.`,

    'Lords Chamber': `Analyze this Lords Chamber debate.
Focus on expert scrutiny, constitutional implications, and legislative improvements.
Highlight cross-party concerns and government responses.`
  };

  // Catchall prompt for any unrecognized types
  const defaultPrompt = `Analyze this parliamentary proceeding.
Focus on key policy points, cross-party positions, and practical implications.
Highlight significant outcomes and any ministerial commitments made.`;

  return await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [{
      role: "system",
      content: `You are an expert in UK parliamentary procedure and debate analysis.
${summaryPrompts[typeSpecificPrompt] || defaultPrompt}
Provide:
- A snappy, newspaper-style, politically neutral title (max 10 words)
- Three concise, analytical sentences in Financial Times style
- Tone assessment based on debate dynamics

Remember: Focus on analysis - readers know the context.`
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
      Note any departure from previously stated government position.`,

    'Main': `
      This is a main Chamber debate.
      Focus on:
      - The core policy or legislative issue under discussion
      - Key arguments from both government and opposition
      - Cross-party consensus or areas of disagreement
      - Specific amendments or changes proposed
      - Ministerial responses and commitments made
      Note the significance of main Chamber debates in shaping government policy.`,

    'Debated Bill': `
      This is a bill debate in the main Chamber.
      Focus on:
      - The key provisions and changes proposed in the bill
      - Major points of contention between parties
      - Specific amendments being discussed
      - Government's response to concerns raised
      - Cross-party support or opposition
      Note that these debates shape the final form of legislation.`,

    'Debated Motion': `
      This is a motion debate in the main Chamber.
      Focus on:
      - The specific proposal or position being debated
      - Arguments for and against the motion
      - Any amendments tabled
      - Government's stance and response
      - Likely practical implications if passed
      Note that while some motions are binding, others are expressions of House opinion.`
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
  // Only generate questions for specific debate types
  const allowedTypes = [
    'Main',
    'Debated Bill',
    'Debated Motion',
    'Westminster Hall',
    'Statement'
  ];

  // If not an allowed type, return default empty question
  if (!allowedTypes.includes(typeSpecificPrompt)) {
    logger.debug('Skipping question generation for debate type:', typeSpecificPrompt);
    return {
      choices: [{
        message: {
          parsed: {
            question: {
              text: '',
              topic: 'Parliamentary Affairs and Governance'
            }
          }
        }
      }]
    };
  }

  const questionPrompts = {
    'Main': `Generate a question about the core policy implications or cross-party positions discussed.`,
    'Debated Bill': `Generate a question about the key legislative changes or their practical impact.`,
    'Debated Motion': `Generate a question about the motion's specific proposal or its consequences.`,
    'Westminster Hall': `Generate a question about the constituency impacts or ministerial commitments made.`,
    'Statement': `Generate a question about the policy announcement or government position.`
  };

  return await openai.beta.chat.completions.parse({
    model: "gpt-4o",
    messages: [{
      role: "system",
      content: `You are an expert in survey design for the British public.
      
${questionPrompts[typeSpecificPrompt]}

Generate a yes/no question about this debate that:
- Is thought-provoking, provocative, and highlights political differences in British politics
- Is accessible to a person with no specialist knowledge of this topic
- Is phrased concisely
- Reflects this type of parliamentary proceeding
- Focuses on the most significant policy implication
- Uses clear, accessible language
- Avoids leading or biased language

Good phrasing examples:
- "Should the UK update its environmental laws to address climate change?"
- "Should obligations to the International Criminal Court be prioritised over diplomatic relations with Israel?"
- "Should defence spending be increased to strengthen the UK's relationship with the US?"

Bad phrasing examples:
- "Should the government prioritise revisiting technical amendments in legislation to address outdated environmental policies?"
- "Should the UK Government prioritise its international obligations to the International Criminal Court over diplomatic relations with countries like Israel?"
- "Do you believe that the UK should increase its defence spending to strengthen its relationship with the US?"

Format your response as a single question with:
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
      
      For each key point:
      - Phrase the points as though they were made by the speaker themselves
      - Include the speaker's party affiliation when mentioned in the text
      - Group support/opposition by party where possible
      - Consider party dynamics when identifying agreements and disagreements
      - Ensure every speaker is mentioned at least once
      - Pay special attention to cross-party agreements and intra-party disagreements
      - Note if the speaker is from the Government or Opposition front bench
      
      When identifying support and opposition:
      - Consider both explicit and implicit support/opposition
      - Note if support/opposition follows party lines
      - Highlight any unexpected cross-party alliances
      - Include both backbench and frontbench positions`
    }, {
      role: "user",
      content: text
    }],
    response_format: zodResponseFormat(KeyPointSchema, 'keyPoints')
  });
}

// Helper function to format questions (moved from inline)
function formatQuestionFields(question) {
  try {
    if (!question) {
      logger.warn('Question object is undefined');
      return {
        ai_question: '',
        ai_question_topic: 'Parliamentary Affairs and Governance',
        ai_question_ayes: 0,
        ai_question_noes: 0
      };
    }
    
    return {
      ai_question: question.text || '',
      ai_question_topic: question.topic || 'Parliamentary Affairs and Governance',
      ai_question_ayes: 0,
      ai_question_noes: 0
    };
  } catch (error) {
    logger.error('Failed to format question fields', {
      error: error.message,
      stack: error.stack
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