export interface Example {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface CharacterInfo {
  hanzi: string;
  traditional?: string;
  pinyin: string;
  meaning: string[];
  components: CharacterInfo[];
  alternates?: { pinyin: string; meaning: string[] }[];
}

export interface WordCore {
  hanzi: string;
  pinyin: string;
  english: string[];
  polish?: string[];
  hskLevel: number;
}

export interface Word extends WordCore {
  wordFrequencyRank?: number;
  hanziFrequencyRank?: number;
  examples: Example[];
  translatable: boolean;
  breakdown?: CharacterInfo[];
  categories: string[];
  /** Labels inferred by the AI, kept separate from the user's own categories */
  aiCategories: string[];
  manual: boolean;
  queuedAt?: string;
  charQueuedAt?: string;
  mandarinspotTranslation?: {
    pinyin: string[];
    defs: string[];
    traditional?: string;
  };
}

export type PracticeMode = 'hanzi2pinyin' | 'english2hanzi' | 'english2pinyin';

export interface Progress {
  id: number;
  hanzi: string;
  mode: PracticeMode;
  bucket: number;
  lastPracticed: string | null;
  nextEligible: string | null;
  correctCount: number;
  incorrectCount: number;
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
  wordSelection: 'review' | 'random';
  categories: string[];
  excludedCategories?: string[];
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
  incorrectCount: number;
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
  characterMode: boolean;
  totalWords: number;
  learned: number;
  dueForReview: number;
  newWordsCount: number;
  buckets: number[]; // count of words in each bucket (index = bucket number)
  dueBuckets: number[]; // count of due words in each bucket
  dueByDay: number[]; // count of words due each day for next 7 days in server local time (index 0 = today, includes overdue)
}

export interface SynonymEntry {
  hanzi: string;
  pinyin: string;
  english: string[];
}

export interface LookupResponse {
  entries: CedictEntry[];
  existing: Word | null;
  maxBucket: number | null;
  breakdown: CharacterInfo[];
  wordRank: number | null;
  charRank: number | null;
  synonyms: SynonymEntry[];
}

/**
 * How the model judged the input text:
 * - `ok`: a real, natural word/phrase/sentence
 * - `unnatural`: understandable but awkward, unidiomatic or vanishingly rare
 * - `invalid`: not a real word, ungrammatical or nonsensical
 */
export type InferVerdict = 'ok' | 'unnatural' | 'invalid';

export interface InferResponse {
  verdict: InferVerdict;
  pinyin: string;
  english: string[];
  polish: string[];
  /**
   * Inferred labels: `sentence` for a full sentence, `expression` for a multi-word
   * phrase, or one or more parts of speech for a single word — plus a register
   * label (`casual`, `neutral`, `formal`, `written`, `vernacular`, `vulgar`).
   */
  categories: string[];
  /** Why the verdict was given — usage note for `ok`, explanation of the problem otherwise */
  notes: string;
  /** A corrected or more idiomatic form, when the model can offer one */
  suggestion?: string;
}

export interface CedictEntry {
  traditional: string;
  simplified: string;
  pinyin: string; // With tone marks
  pinyinNumbered: string; // Original numbered format from CEDICT
  definitions: string[];
}


export interface SpeechAssessResponse {
  accuracyScore: number;
  synonym?: string; // if the best match was a synonym, which one
}

export interface SearchResult {
  word: Word;
  progress: Progress[];
  queued?: boolean;
}

export type MatchMode = 'prefix' | 'contains' | 'suffix' | 'exact';
