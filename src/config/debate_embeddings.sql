create table debate_embeddings (
  id uuid primary key default uuid_generate_v4(),
  debate_id uuid references debates(id) unique not null,
  embedding vector(1536) not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index on debate_embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);