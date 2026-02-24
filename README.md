# Memchin

A web-based spaced repetition system for learning Chinese vocabulary. Practice across multiple modes (hanzi, pinyin, English) with SRS scheduling, CEDICT dictionary lookups, character decomposition, example sentence generation, and text-to-speech audio.

## Features

- **Spaced repetition** — 9-level bucket system with exponential intervals (immediate → 30 days)
- **Four practice modes** — Hanzi→Pinyin, Hanzi→English, English→Hanzi, English→Pinyin
- **CEDICT dictionary** — 124k entries sorted by word frequency for lookup and word addition
- **Character decomposition** — Recursive breakdown of hanzi into components using IDS data
- **Example sentences** — Auto-generated via GPT-4o (phrase, simple, complex)
- **Text-to-speech** — Google Cloud TTS for word and sentence pronunciation
- **Word management** — Add/edit words with pinyin, translations, and categories
- **Category filtering** — HSK levels, topic lists (clothing, family, body, etc.)
- **Character mode** — Practice individual characters extracted from learned words
- **Pinyin handling** — Flexible matching between tone-marked (fàn) and numbered (fan4) formats

## Tech Stack

- **Frontend**: TypeScript, Vite, vanilla DOM
- **Backend**: TypeScript, Express, sql.js (SQLite)
- **External services**: Google Cloud TTS, OpenAI GPT-4o

## Setup

```bash
npm install
```

### Required credentials

**Google Cloud TTS** — Place `gcp-service-account-key.json` in the project root.

**OpenAI** — Set `OPENAI_API_KEY` environment variable (used for example sentence generation).

Both are optional — the app works without them, but audio and examples won't be generated for new words.

### Import vocabulary

```bash
npm run hsk-to-json    # Parse HTML/text sources into hsk_words.json
npm run import-hsk     # Import hsk_words.json into the database + generate audio/examples
```

### Run

```bash
npm run dev            # Start dev server (client on :5173, API on :3000)
npm run build          # Production build
```

## Project Structure

```
src/
├── client/            # Frontend (SPA)
│   ├── index.html
│   ├── main.ts        # UI logic and DOM manipulation
│   ├── services.ts    # API client
│   └── style.css
├── server/
│   ├── index.ts       # Express app
│   ├── db.ts          # SQLite database layer
│   ├── routes/
│   │   ├── practice.ts   # Practice session endpoints
│   │   └── words.ts      # Word CRUD endpoints
│   └── services/
│       ├── srs.ts        # Spaced repetition algorithm
│       ├── cedict.ts     # CEDICT dictionary
│       ├── pinyin.ts     # Pinyin conversion and matching
│       ├── ids.ts        # Character decomposition
│       └── tts.ts        # Google Cloud TTS
├── shared/
│   └── types.ts       # Shared TypeScript types
└── scripts/
    ├── import-hsk.ts           # Database import
    ├── hsk-to-json.ts          # Source file parsing
    ├── generate-examples.ts    # GPT-4o example generation
    └── sort-cedict-by-freq.ts  # Frequency-sort CEDICT

sources/               # Dictionary and vocabulary source files
data/                  # SQLite database and generated audio (gitignored)
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (client + API) |
| `npm run build` | Production build |
| `npm run import-hsk` | Import vocabulary into database |
| `npm run hsk-to-json` | Parse source files to JSON |
| `npm run regenerate-examples` | Regenerate example sentences |
| `npm run test` | Run tests |
| `npm run format` | Format code with Prettier |
