// Types (duplicated from shared to avoid Vite path issues)
export type PracticeMode = 'pinyin' | 'english' | 'hanzi';

export interface Example {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface Word {
  id: number;
  hanzi: string;
  pinyin: string;
  pinyinNumbered: string;
  english: string[];
  hskLevel: number;
  frequencyRank: number;
  examples: Example[];
}

export interface PracticeQuestion {
  word: Word;
  prompt: string;
  acceptedAnswers: string[];
}

interface StartResponse {
  sessionId: string;
  questions: PracticeQuestion[];
}

interface AnswerResponse {
  correct: boolean;
  correctAnswers: string[];
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
}

const API_BASE = '/api';

export async function startPractice(count: number, mode: PracticeMode): Promise<StartResponse> {
  const response = await fetch(`${API_BASE}/practice/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count, mode }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start practice');
  }

  return response.json();
}

export async function submitAnswer(
  sessionId: string,
  wordId: number,
  answer: string
): Promise<AnswerResponse> {
  const response = await fetch(`${API_BASE}/practice/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, wordId, answer }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to submit answer');
  }

  return response.json();
}

export async function completePractice(
  sessionId: string,
  results: Array<{ wordId: number; correctFirstTry: boolean }>
): Promise<CompleteResponse> {
  const response = await fetch(`${API_BASE}/practice/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, results }),
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

export async function getWordCount(): Promise<number> {
  const response = await fetch(`${API_BASE}/words/count`);

  if (!response.ok) {
    throw new Error('Failed to get word count');
  }

  const data = await response.json();
  return data.count;
}
