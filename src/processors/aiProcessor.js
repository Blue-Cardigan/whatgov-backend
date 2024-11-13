import { openai } from '../services/openai.js';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import translator from 'american-british-english-translator';

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

export async function processAIContent(debate, memberDetails) {
  // Process and clean debate text
  const processedItems = processDebateItems(debate.Items, memberDetails);
  const debateText = formatDebateContext(debate.Overview, processedItems);

  // Generate all AI responses concurrently
  const [summary, questions, topics, keyPoints] = await Promise.all([
    (await generateSummary(debateText)).choices[0].message.parsed,
    (await generateQuestions(debateText)).choices[0].message.parsed,
    (await extractTopics(debateText)).choices[0].message.parsed,
    (await extractKeyPoints(debateText)).choices[0].message.parsed
  ]);

  // console.log(summary, questions, topics, keyPoints);

  // Handle potential refusals
  if (summary.refusal || questions.refusal || topics.refusal || keyPoints.refusal) {
    throw new Error('AI refused to process debate content');
  }

  // Add translation options
  const translationOptions = {
    british: true,  // Only identify British translations
    spelling: true  // Include spelling differences
  };

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

  // Format questions into individual fields
  const questionFields = formatQuestionFields(translatedQuestions.questions);

  return {
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
    tags: translatedTopics.topics.flatMap(t => t.subtopics.map(st => handleBritishTranslation(st, translationOptions)))
  };
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
      Provide a snappy title and 2 sentence analysis for this parliamentary debate, in the style of a Financial Times article. 
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
3. Identify specific subtopics within each main topic (avoid overlapping terms and overly broad descriptions)

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
      content: "You are an expert UK parliamentary analyst. Identify the key points from this debate and the speakers who made them. Phrase the points as though they were made by the speaker themselves. Identify speakers who supported or opposed each point."
    }, {
      role: "user",
      content: text
    }],
    response_format: zodResponseFormat(KeyPointSchema, 'keyPoints')
  });
}

// Helper function to format questions (moved from inline)
function formatQuestionFields(questions) {
  const questionFields = {};
  questions.forEach((q, index) => {
    const num = index + 1;
    questionFields[`ai_question_${num}`] = q.text;
    questionFields[`ai_question_${num}_topic`] = q.topic;
    questionFields[`ai_question_${num}_ayes`] = 0;
    questionFields[`ai_question_${num}_noes`] = 0;
  });
  return questionFields;
}

// Add new helper function to handle translations
function handleBritishTranslation(text, options) {
    const analysis = translator.translate(text, options);
    let translatedText = text;
    
    // Only process if we have analysis results
    if (analysis && analysis['1']) {
        // Process each identified word/phrase
        analysis['1'].forEach(item => {
            // Get the first (and only) key from the object
            const americanWord = Object.keys(item)[0];
            const details = item[americanWord];

            // Handle different types of issues
            switch (details.issue) {
                case 'American English Spelling':
                    // Direct replacement with British spelling
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
}