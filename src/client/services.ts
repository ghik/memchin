// Types (duplicated from shared to avoid Vite path issues)
export type PracticeMode = 'hanzi2pinyin' | 'hanzi2english' | 'english2hanzi' | 'english2pinyin';

export interface Example {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface CharacterBreakdown {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

export interface Word {
  hanzi: string;
  pinyin: string;
  english: string[];
  hskLevel: number;
  wordFrequencyRank?: number;
  hanziFrequencyRank?: number;
  examples: Example[];
  translatable: boolean;
  breakdown?: CharacterBreakdown[];
  categories: string[];
}

export interface PracticeQuestion {
  word: Word;
  prompt: string;
  acceptedAnswers: string[];
  bucket: number | null;
}

interface StartResponse {
  questions: PracticeQuestion[];
}

interface AnswerResponse {
  correct: boolean;
  correctAnswers: string[];
  synonym: boolean;
}

interface CompleteResponse {
  wordsReviewed: number;
  newWordsLearned: number;
}

interface Stats {
  mode: PracticeMode;
  totalWords: number;
  learned: number;
  mastered: number;
  dueForReview: number;
  buckets: number[];
}

const API_BASE = '/api';

export async function startPractice(count: number, mode: PracticeMode, wordSelection: string, categories: string[], singleCharOnly: boolean): Promise<StartResponse> {
  const body = { count, mode, wordSelection, categories, singleCharOnly };
  const response = await fetch(`${API_BASE}/practice/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start practice');
  }

  return response.json();
}

export async function submitAnswer(
  mode: PracticeMode,
  hanzi: string,
  answer: string
): Promise<AnswerResponse> {
  const response = await fetch(`${API_BASE}/practice/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, hanzi, answer }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to submit answer');
  }

  return response.json();
}

export async function completePractice(
  mode: PracticeMode,
  results: Array<{ hanzi: string; correctFirstTry: boolean }>
): Promise<CompleteResponse> {
  const response = await fetch(`${API_BASE}/practice/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, results }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to complete practice');
  }

  return response.json();
}

export async function getStats(): Promise<Stats[]> {
  const response = await fetch(`${API_BASE}/practice/stats`);

  if (!response.ok) {
    throw new Error('Failed to get stats');
  }

  return response.json();
}

export async function markPinyinSynonym(hanzi: string, synonymPinyin: string): Promise<void> {
  const response = await fetch(`${API_BASE}/practice/synonym`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hanzi, synonymPinyin }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to mark synonym');
  }
}

export async function getCategories(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/categories`);
  if (!response.ok) {
    throw new Error('Failed to get categories');
  }
  return response.json();
}

export async function getWordCount(): Promise<number> {
  const response = await fetch(`${API_BASE}/words/count`);

  if (!response.ok) {
    throw new Error('Failed to get word count');
  }

  const data = await response.json();
  return data.count;
}
