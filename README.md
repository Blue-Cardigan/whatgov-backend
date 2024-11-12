# Hansard Debate Processor

Process UK Parliamentary debates from Hansard and store them in Supabase with AI-generated analysis.

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your API keys
3. Install dependencies: 
   
```bash
npm install
```
## Usage

Run the processor:

```bash
npm start
```

Development mode with auto-reload:

```bash
npm run dev
```

## Configuration

Configure the processor through environment variables in `.env`:

- `BATCH_SIZE`: Number of debates to process in parallel
- `ENABLE_AI_PROCESSING`: Enable/disable OpenAI processing
- `ENABLE_SPEAKER_STATS`: Enable/disable speaker statistics
- `LOG_LEVEL`: Logging detail level (ERROR, WARN, INFO, DEBUG)

## License

MIT