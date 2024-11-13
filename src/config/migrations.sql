-- Core debates table with minimal required data
CREATE TABLE debates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ext_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  date DATE NOT NULL,
  
  -- Basic metadata
  type TEXT NOT NULL,
  house TEXT NOT NULL,
  location TEXT NOT NULL,

    -- Quick stats
  speaker_count INT NOT NULL DEFAULT 0,
  contribution_count INT NOT NULL DEFAULT 0,
  party_count JSONB NOT NULL DEFAULT '{}',
  interest_score INT NOT NULL DEFAULT 0,
  interest_factors JSONB NOT NULL DEFAULT '{}',
  
  -- AI-generated content
  ai_title TEXT NOT NULL DEFAULT '',
  ai_summary TEXT NOT NULL DEFAULT '',  
  ai_tone TEXT NOT NULL DEFAULT '' CHECK (ai_tone IN ('neutral', 'contentious', 'collaborative')),
  ai_question_1 TEXT NOT NULL DEFAULT '',
  ai_question_1_topic TEXT NOT NULL DEFAULT '',
  ai_question_1_ayes INT NOT NULL DEFAULT 0,
  ai_question_1_noes INT NOT NULL DEFAULT 0,
  ai_question_2 TEXT NOT NULL DEFAULT '',
  ai_question_2_topic TEXT NOT NULL DEFAULT '',
  ai_question_2_ayes INT NOT NULL DEFAULT 0,
  ai_question_2_noes INT NOT NULL DEFAULT 0,
  ai_question_3 TEXT NOT NULL DEFAULT '',
  ai_question_3_topic TEXT NOT NULL DEFAULT '',
  ai_question_3_ayes INT NOT NULL DEFAULT 0,
  ai_question_3_noes INT NOT NULL DEFAULT 0,
  ai_topics JSONB NOT NULL DEFAULT '[]',
  ai_tags JSONB NOT NULL DEFAULT '[]',
  ai_key_points JSONB NOT NULL DEFAULT '[]',
    
  -- Navigation
  parent_ext_id TEXT NOT NULL,
  parent_title TEXT NOT NULL,
  prev_ext_id TEXT,
  next_ext_id TEXT,
  
  -- Search optimization
  search_text TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  
  -- Optional: Add a GIN index for full-text search
  -- If using a separate search service like Algolia, this can be removed
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', 
      title || ' ' || 
      COALESCE(ai_summary, '') || ' ' || 
      COALESCE(search_text, '')
    )
  ) STORED
);

-- Indexes
CREATE INDEX idx_debates_ext_id ON debates(ext_id);
CREATE INDEX idx_debates_date ON debates(date DESC);
CREATE INDEX idx_debates_parent ON debates(parent_ext_id);
CREATE INDEX idx_debates_search ON debates USING GIN(search_vector);