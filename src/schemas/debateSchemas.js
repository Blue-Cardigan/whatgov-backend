import { z } from 'zod';

// Define schemas for each type of response
export const SummarySchema = z.object({
    title: z.string(),
    overview: z.string(),
    summary: z.string(),
    tone: z.enum(['neutral', 'contentious', 'collaborative']),
    wordCount: z.number(),
    keyThemes: z.array(z.string()).optional(),
    mainSpeakers: z.array(z.object({
      name: z.string(),
      role: z.string().optional(),
      party: z.string().optional(),
      contribution: z.string().optional()
    })).optional()
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
        memberId: z.string().nullable(),
        party: z.string().nullable(),
        constituency: z.string().nullable(),
        subtopics: z.array(z.string()),
        frequency: z.number()
      }))
    })
  )
});
  
export const SpeakerDetailsSchema = z.object({
  name: z.string(),
  memberId: z.string().nullable(),
  party: z.string().nullable(),
  constituency: z.string().nullable()
});

export const KeyPointSchema = z.object({
  keyPoints: z.array(z.object({
    point: z.string(),
    speaker: SpeakerDetailsSchema,
    support: z.array(SpeakerDetailsSchema),
    opposition: z.array(SpeakerDetailsSchema),
    context: z.string().nullable(),
    keywords: z.array(z.string())
  }))
});
  
  // Add new schema for division questions
export const DivisionQuestionSchema = z.object({
  questions: z.array(z.object({
    question_text: z.string(),
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
    explanation: z.string(),
    arguments: z.object({
      for: z.array(z.string()),
      against: z.array(z.string())
    })
  }))
});
  
  // Add new schema after existing schemas
export const CommentThreadSchema = z.object({
    comments: z.array(z.object({
      id: z.string(),
      parent_id: z.string().nullable(),
      author: SpeakerDetailsSchema,
      content: z.string(),
      votes: z.object({
        upvotes: z.number(),
        upvotes_speakers: z.array(SpeakerDetailsSchema),
        downvotes: z.number(),
        downvotes_speakers: z.array(SpeakerDetailsSchema)
      }),
      tags: z.array(z.string())
    }))
  });