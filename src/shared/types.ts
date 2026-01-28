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
  id: number;
  hanzi: string;
  pinyin: string;
  english: string[];
  hskLevel: number;
  frequencyRank: number;
  examples: Example[];
  translatable: boolean;
  breakdown?: CharacterBreakdown[];
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
  bucket: number | null; // null = new word
}

export interface StartRequest {
  count: number;
  mode: PracticeMode;
}

export interface StartResponse {
  questions: PracticeQuestion[];
}

export interface AnswerRequest {
  mode: PracticeMode;
  wordId: number;
  answer: string;
}

export interface AnswerResponse {
  correct: boolean;
  correctAnswers: string[];
  synonym: boolean; // True if answer is a valid synonym but not the target word
}

export interface CompleteRequest {
  mode: PracticeMode;
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
  buckets: number[]; // count of words in each bucket (index = bucket number)
}
