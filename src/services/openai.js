import OpenAI from 'openai';
import { config } from '../config/config.js';
import logger from '../utils/logger.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY
});

export class OpenAIService {
  static async generateCompletion(prompt, options = {}) {
    try {
      const response = await openai.chat.completions.create({
        model: options.model || "gpt-4o",
        messages: [{
          role: "system",
          content: options.systemPrompt || "You are analyzing parliamentary debates."
        }, {
          role: "user",
          content: prompt
        }],
        temperature: options.temperature || 0,
        max_tokens: options.maxTokens || 500
      });

      return response.choices[0].message.content;
    } catch (error) {
      logger.error('OpenAI API error:', error);
      throw error;
    }
  }
}

export { openai }; 