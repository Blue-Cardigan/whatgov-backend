import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import OpenAI from 'openai';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export const config = {
  // API Keys
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  SERVICE_KEY: process.env.SERVICE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  HANSARD_API_KEY: process.env.HANSARD_API_KEY,

  // Processing settings
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE || '10'),
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3'),
  RETRY_DELAY: parseInt(process.env.RETRY_DELAY || '1000'),

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'INFO',

  // Default assistant ID
  DEFAULT_ASSISTANT_ID: process.env.DEFAULT_OPENAI_ASSISTANT_ID,
  WEEKLY_ASSISTANT_ID: process.env.WEEKLY_OPENAI_ASSISTANT_ID,
  OPENAI: openai
}; 
