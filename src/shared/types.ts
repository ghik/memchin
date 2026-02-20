export interface Example {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface CharacterInfo {
  hanzi: string;
  pinyin: string;
  meaning: string;
  components: CharacterInfo[];
}

export interface WordCore {
  hanzi: string;
  pinyin: string;
  english: string[];
  hskLevel: number;
}

export interface Word extends WordCore {
  wordFrequencyRank?: number;
  hanziFrequencyRank?: number;
  examples: Example[];
  translatable: boolean;
  breakdown?: CharacterInfo[];
  categories: string[];
  manual: boolean;
}

export type PracticeMode = 'hanzi2pinyin' | 'hanzi2english' | 'english2hanzi' | 'english2pinyin';

export interface Progress {
  id: number;
  hanzi: string;
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
  containingWords: ContainingWord[];
}

export interface StartRequest {
  count: number;
  mode: PracticeMode;
  wordSelection: 'mixed' | 'new' | 'review' | 'random';
  categories: string[];
  characterMode: boolean;
  hanziList?: string[]; // specific words to practice (overrides count/wordSelection/categories)
}

export interface StartResponse {
  questions: PracticeQuestion[];
}

export interface AnswerRequest {
  mode: PracticeMode;
  hanzi: string;
  answer: string;
}

export interface ContainingWord {
  hanzi: string;
  pinyin: string;
  english: string[];
}

export interface AnswerResponse {
  correct: boolean;
  correctAnswers: string[];
  synonym: boolean; // True if answer is a valid synonym but not the target word
}

export interface PracticeResult {
  hanzi: string;
  correctFirstTry: boolean;
}

export interface CompleteRequest {
  mode: PracticeMode;
  results: PracticeResult[];
  characterMode: boolean;
}

export interface WordProgress {
  hanzi: string;
  bucket: number;
  nextEligible: string;
}

export interface CompleteResponse {
  wordsReviewed: number;
  newWordsLearned: number;
  progress: WordProgress[];
}

export interface Stats {
  mode: PracticeMode;
  totalWords: number;
  learned: number;
  mastered: number;
  dueForReview: number;
  buckets: number[]; // count of words in each bucket (index = bucket number)
}

export interface CedictEntry {
  traditional: string;
  simplified: string;
  pinyin: string; // With tone marks
  pinyinNumbered: string; // Original numbered format from CEDICT
  definitions: string[];
}
