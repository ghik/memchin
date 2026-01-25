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

export type PracticeMode = 'pinyin' | 'english' | 'hanzi';

export interface Progress {
  id: number;
  wordId: number;
  mode: PracticeMode;
  bucket: number;
  lastPracticed: string | null;
  nextEligible: string | null;
}

export interface PracticeQuestion {
  word: Word;
  prompt: string;
  acceptedAnswers: string[];
}

export interface StartRequest {
  count: number;
  mode: PracticeMode;
}

export interface StartResponse {
  sessionId: string;
  questions: PracticeQuestion[];
}

export interface AnswerRequest {
  sessionId: string;
  wordId: number;
  answer: string;
}

export interface AnswerResponse {
  correct: boolean;
  correctAnswers: string[];
}

export interface CompleteRequest {
  sessionId: string;
  results: Array<{ wordId: number; correctFirstTry: boolean }>;
}

export interface CompleteResponse {
  wordsReviewed: number;
  newWordsLearned: number;
}

export interface Stats {
  mode: PracticeMode;
  totalWords: number;
  learned: number;
  mastered: number;
  dueForReview: number;
}
