create table debate_chunks (
    id uuid primary key default uuid_generate_v4(),
    debate_id uuid references debates(id),
    chunk_text text not null,
    chunk_type text not null, -- e.g., 'contribution', 'summary', 'key_point'
    speaker_id text,
    speaker_name text,
    speaker_party text,
    embedding vector(1536),
    created_at timestamp with time zone default now()
);

create index on debate_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);