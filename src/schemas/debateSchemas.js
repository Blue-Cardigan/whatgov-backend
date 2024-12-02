import { z } from 'zod';

// Define schemas for each type of response
export const SummarySchema = z.object({
    title: z.string(),
    sentence1: z.string(),
    sentence2: z.string(),
    sentence3: z.string(),
    tone: z.enum(['neutral', 'contentious', 'collaborative']),
    wordCount: z.number()
  });
  
export const QuestionsSchema = z.object({
    question: z.object({
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
      subtopics: z.array(z.string())
    })
});
  
export const TopicSchema = z.object({
  topics: z.array(
    z.object({
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
      frequency: z.number(),
      speakers: z.array(z.object({
        name: z.string(),
        subtopics: z.array(z.string()),
        frequency: z.number()
      }))
    })
  )
});
  
export const KeyPointSchema = z.object({
    keyPoints: z.array(z.object({
      point: z.string(),
      speaker: z.string(),
      support: z.array(z.string()),
      opposition: z.array(z.string())
    }))
  });
  
  // Add new schema for division questions
export const DivisionQuestionSchema = z.object({
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
export const CommentThreadSchema = z.object({
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