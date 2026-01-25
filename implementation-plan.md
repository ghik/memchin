# Chinese Word Practice Program - Implementation Plan

## Overview

A web-based spaced repetition system for learning Chinese vocabulary, supporting multiple practice modes and mobile-friendly handwriting input.

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Backend | TypeScript + Node.js + Express | Type safety, shared types with frontend |
| Database | SQLite + better-sqlite3 | File-based, no setup, synchronous API for simplicity |
| Frontend | TypeScript + Vite | Fast dev server, type checking, minimal config |
| Handwriting | Hanzi Writer | Well-maintained library for Chinese character input |

---

## Data Model

### Types

```typescript
// Word from the HSK vocabulary database
interface Word {
  id: number;
  hanzi: string;           // Chinese characters (e.g., 你好)
  pinyin: string;          // Romanization with tone marks (e.g., nǐ hǎo)
  pinyinNumbered: string;  // Numbered tones (e.g., ni3 hao3)
  english: string[];       // English translations
  hskLevel: number;        // HSK level (1-6)
  frequencyRank: number;   // Position in frequency list (lower = more common)
}

// Practice modes
type PracticeMode = 'pinyin' | 'english' | 'hanzi';

// User progress for a word in a specific mode
interface Progress {
  id: number;
  wordId: number;
  mode: PracticeMode;
  bucket: number;          // Spaced repetition bucket (0-7)
  lastPracticed: Date | null;
  nextEligible: Date | null;
}

// A single question in a practice session
interface PracticeQuestion {
  word: Word;
  prompt: string;          // What to show the user
  acceptedAnswers: string[]; // Valid answers
}

// Practice session state
interface PracticeSession {
  id: string;
  mode: PracticeMode;
  questions: PracticeQuestion[];
  results: Map<number, boolean>; // wordId -> correct on first try
}
```

### Database Schema (SQLite)

```sql
CREATE TABLE words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hanzi TEXT NOT NULL UNIQUE,
  pinyin TEXT NOT NULL,
  pinyin_numbered TEXT NOT NULL,
  english TEXT NOT NULL,  -- JSON array
  hsk_level INTEGER NOT NULL,
  frequency_rank INTEGER NOT NULL
);

CREATE TABLE progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  bucket INTEGER NOT NULL DEFAULT 0,
  last_practiced TEXT,  -- ISO timestamp
  next_eligible TEXT,   -- ISO timestamp
  FOREIGN KEY (word_id) REFERENCES words(id),
  UNIQUE(word_id, mode)
);

CREATE INDEX idx_progress_mode_eligible ON progress(mode, next_eligible);
CREATE INDEX idx_words_frequency ON words(frequency_rank);
```

---

## Spaced Repetition Algorithm

### Bucket System
```typescript
const BUCKET_DELAYS_MINUTES: Record<number, number> = {
  0: 0,        // Immediate
  1: 1,        // 1 minute
  2: 5,        // 5 minutes
  3: 30,       // 30 minutes
  4: 120,      // 2 hours
  5: 480,      // 8 hours
  6: 1440,     // 1 day
  7: 4320,     // 3 days (mastered)
};
```

### Rules
- **Correct answer**: Move up one bucket (max 7)
- **Incorrect answer**: Move down to bucket 0

### Word Selection Priority
1. Words past their `nextEligible` time (due for review), ordered by oldest first
2. New words (no progress record for this mode), ordered by `frequencyRank`
3. Stop when requested word count is reached

---

## Project Structure

```
memchin/
├── src/
│   ├── server/
│   │   ├── index.ts              # Express app entry point
│   │   ├── db.ts                 # SQLite connection and queries
│   │   ├── routes/
│   │   │   ├── words.ts          # Word CRUD endpoints
│   │   │   └── practice.ts       # Practice session endpoints
│   │   └── services/
│   │       ├── srs.ts            # Spaced repetition algorithm
│   │       └── pinyin.ts         # Pinyin normalization utilities
│   ├── client/
│   │   ├── index.html            # Main HTML page
│   │   ├── main.ts               # Client entry point
│   │   ├── api.ts                # API client functions
│   │   ├── components/
│   │   │   ├── StartScreen.ts    # Mode and count selection
│   │   │   ├── PracticeScreen.ts # Question display and input
│   │   │   ├── HandwritingPad.ts # Canvas for character drawing
│   │   │   └── ResultScreen.ts   # Session summary
│   │   └── style.css             # Mobile-responsive styles
│   └── shared/
│       └── types.ts              # Shared TypeScript types
├── scripts/
│   └── import-hsk.ts             # Script to import HSK word lists
├── data/
│   └── memchin.db                # SQLite database file
├── package.json
├── tsconfig.json
├── vite.config.ts
├── project.md
└── implementation-plan.md
```

---

## API Endpoints

### Words
- `GET /api/words` - List all words (with pagination)
- `GET /api/words/:id` - Get single word
- `POST /api/words/import` - Bulk import words

### Practice
```typescript
// POST /api/practice/start
// Start a new practice session
interface StartRequest {
  count: number;
  mode: PracticeMode;
}
interface StartResponse {
  sessionId: string;
  questions: PracticeQuestion[];
}

// POST /api/practice/answer
// Submit an answer (validates and returns result)
interface AnswerRequest {
  sessionId: string;
  wordId: number;
  answer: string;
}
interface AnswerResponse {
  correct: boolean;
  correctAnswers: string[];
}

// POST /api/practice/complete
// End session and update SRS progress
interface CompleteRequest {
  sessionId: string;
  results: Array<{ wordId: number; correctFirstTry: boolean }>;
}
interface CompleteResponse {
  wordsReviewed: number;
  newWordsLearned: number;
}
```

### Stats
- `GET /api/stats` - Get learning statistics per mode

---

## Implementation Phases

### Phase 1: Project Setup & Core Backend
1. Initialize Node.js project with TypeScript
2. Set up Express server with API routes
3. Implement SQLite database layer
4. Create HSK import script (scrape mandarinbean.com)
5. Implement spaced repetition service

### Phase 2: Basic Web UI
1. Set up Vite for frontend bundling
2. Create responsive HTML/CSS layout
3. Implement practice mode selection screen
4. Build question/answer interface
5. Add session summary screen

### Phase 3: Answer Validation
1. Pinyin mode: Normalize input (handle tone numbers ↔ marks)
2. English mode: Accept any listed translation (case-insensitive, trimmed)
3. Hanzi mode: Exact character match

### Phase 4: Handwriting Input
1. Integrate Hanzi Writer library
2. Add canvas-based drawing area
3. Mobile touch support with stylus compatibility
4. Character candidate selection UI

### Phase 5: Polish & Enhancements
1. Add progress statistics dashboard
2. HSK level filtering for practice
3. Dark mode support
4. PWA manifest for mobile install

---

## HSK Data Import

### Source
Primary: https://mandarinbean.com/new-hsk-1-word-list/ (and levels 2-6)

### Import Script Approach
```typescript
// scripts/import-hsk.ts
async function importHskLevel(level: number): Promise<Word[]> {
  const url = `https://mandarinbean.com/new-hsk-${level}-word-list/`;
  const html = await fetch(url).then(r => r.text());
  const words = parseWordTable(html);
  return words.map((w, i) => ({
    ...w,
    hskLevel: level,
    frequencyRank: calculateRank(level, i),
  }));
}
```

### Pinyin Conversion
```typescript
const TONE_MAP: Record<string, string> = {
  'ā': 'a1', 'á': 'a2', 'ǎ': 'a3', 'à': 'a4',
  'ē': 'e1', 'é': 'e2', 'ě': 'e3', 'è': 'e4',
  'ī': 'i1', 'í': 'i2', 'ǐ': 'i3', 'ì': 'i4',
  'ō': 'o1', 'ó': 'o2', 'ǒ': 'o3', 'ò': 'o4',
  'ū': 'u1', 'ú': 'u2', 'ǔ': 'u3', 'ù': 'u4',
  'ǖ': 'v1', 'ǘ': 'v2', 'ǚ': 'v3', 'ǜ': 'v4',
};

function toNumberedPinyin(pinyin: string): string {
  // Convert tone marks to numbered format
}
```

---

## UI Wireframes

### Start Screen
```
┌─────────────────────────────┐
│     Chinese Practice        │
│                             │
│  How many words? [10]       │
│                             │
│  Practice mode:             │
│  ○ Hanzi → Pinyin          │
│  ○ Hanzi → English         │
│  ○ English → Hanzi         │
│                             │
│      [ Start Practice ]     │
└─────────────────────────────┘
```

### Practice Screen (Pinyin Mode)
```
┌─────────────────────────────┐
│  Question 3 of 10           │
│                             │
│         是                  │
│                             │
│  Your answer:               │
│  ┌─────────────────────┐    │
│  │ shi4                │    │
│  └─────────────────────┘    │
│                             │
│      [ Submit Answer ]      │
└─────────────────────────────┘
```

### Practice Screen (Hanzi Mode with Handwriting)
```
┌─────────────────────────────┐
│  Question 5 of 10           │
│                             │
│  "to be / yes"              │
│                             │
│  Draw character:            │
│  ┌─────────────────────┐    │
│  │                     │    │
│  │    (canvas area)    │    │
│  │                     │    │
│  └─────────────────────┘    │
│  Recognized: 是 时 事       │
│                             │
│      [ Submit Answer ]      │
└─────────────────────────────┘
```

### Result Screen
```
┌─────────────────────────────┐
│     Session Complete!       │
│                             │
│  ✓ 8 correct on first try   │
│  ✗ 2 needed retry           │
│                             │
│  Mistakes reviewed:         │
│  是 (shì) - to be           │
│  他 (tā) - he/him           │
│                             │
│      [ Practice Again ]     │
└─────────────────────────────┘
```

---

## Key Implementation Details

### Session Flow
1. User selects count and mode, clicks "Start"
2. Backend selects words using SRS algorithm
3. Frontend receives questions and shuffles them
4. For each word:
   - Display prompt (hanzi or english)
   - Accept user input
   - POST to `/api/practice/answer` for validation
   - Show result (correct/incorrect with correct answer)
   - Track results locally
5. After all words: retry incorrect ones
6. Repeat until all correct
7. POST to `/api/practice/complete` to update progress

### Answer Normalization

```typescript
// src/server/services/pinyin.ts
function normalizePinyin(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    // Convert numbered to marked or vice versa for comparison
}

function matchesAnyTranslation(input: string, translations: string[]): boolean {
  const normalized = input.toLowerCase().trim();
  return translations.some(t => t.toLowerCase().trim() === normalized);
}

function matchesHanzi(input: string, expected: string): boolean {
  return input.trim() === expected.trim();
}
```

---

## Dependencies

### package.json
```json
{
  "name": "memchin",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "tsx watch src/server/index.ts",
    "dev:client": "vite",
    "build": "tsc && vite build",
    "import-hsk": "tsx scripts/import-hsk.ts"
  },
  "dependencies": {
    "express": "^4.18.2",
    "better-sqlite3": "^9.4.0",
    "cors": "^2.8.5",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/uuid": "^9.0.7",
    "concurrently": "^8.2.2",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3",
    "vite": "^5.0.12"
  }
}
```

---

## Getting Started Commands

```bash
# Install dependencies
npm install

# Import HSK vocabulary data
npm run import-hsk

# Run development server (backend + frontend)
npm run dev

# Open browser
open http://localhost:5173
```

---

## Future Enhancements (Out of Scope)

- User accounts and cloud sync
- Audio pronunciation playback
- Sentence examples
- Character stroke order animation
- Spaced repetition tuning per user
- Export/import progress data
