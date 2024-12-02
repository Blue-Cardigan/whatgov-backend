import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

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

  // Feature flags
  ENABLE_AI_PROCESSING: process.env.ENABLE_AI_PROCESSING !== 'false',
  ENABLE_SPEAKER_STATS: process.env.ENABLE_SPEAKER_STATS !== 'false',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'INFO'
}; 