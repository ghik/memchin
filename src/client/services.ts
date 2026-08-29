import type {
  AnswerResponse,
  CedictEntry,
  CharacterInfo,
  CompleteResponse,
  InferResponse,
  LookupResponse,
  MatchMode,
  PracticeMode,
  PracticeQuestion,
  PracticeResult,
  Progress,
  SearchResult,
  SentenceGradeResponse,
  SentenceQuestionsResponse,
  SpeechAssessResponse,
  StartResponse,
  Stats,
  SynonymEntry,
  Word,
  WordProgress,
} from '../shared/types.js';

export type {
  CedictEntry,
  CharacterInfo,
  InferResponse,
  InferVerdict,
  MatchMode,
  PracticeMode,
  PracticeQuestion,
  Progress,
  SearchResult,
  SentenceGradeResponse,
  SentenceQuestion,
  SentenceVerdict,
  SynonymEntry,
  Word,
  WordProgress,
} from '../shared/types.js';

const API_BASE = '/api';

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || `GET ${path} failed`);
  }
  return response.json();
}

async function apiPost<T>(path: string, data: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || `POST ${path} failed`);
  }
  return response.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || `DELETE ${path} failed`);
  }
  return response.json();
}

async function apiPut<T>(path: string, data: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || `PUT ${path} failed`);
  }
  return response.json();
}

export function startPractice(
  count: number,
  mode: PracticeMode,
  wordSelection: string,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean,
  hanziList?: string[]
): Promise<StartResponse> {
  return apiPost('/practice/start', {
    count,
    mode,
    wordSelection,
    categories,
    excludedCategories,
    characterMode,
    hanziList,
  });
}

export function submitAnswer(
  mode: PracticeMode,
  hanzi: string,
  answer: string
): Promise<AnswerResponse> {
  return apiPost('/practice/answer', { mode, hanzi, answer });
}

export function completePractice(
  mode: PracticeMode,
  results: PracticeResult[],
  characterMode: boolean
): Promise<CompleteResponse> {
  return apiPost('/practice/complete', { mode, results, characterMode });
}

export function getStats(categories: string[], excludedCategories: string[]): Promise<Stats[]> {
  const params = new URLSearchParams();
  if (categories.length > 0) params.set('categories', categories.join(','));
  if (excludedCategories.length > 0) params.set('excludedCategories', excludedCategories.join(','));
  return apiGet(`/practice/stats?${params}`);
}

export function addHanziSynonym(hanzi: string, synonymHanzi: string): Promise<void> {
  return apiPost('/practice/hanzi-synonym', { hanzi, synonymHanzi });
}

export async function getDueCount(
  mode: PracticeMode,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean
): Promise<number> {
  const params = new URLSearchParams({ mode, characterMode: String(characterMode) });
  if (categories.length > 0) params.set('categories', categories.join(','));
  if (excludedCategories.length > 0) params.set('excludedCategories', excludedCategories.join(','));
  const data = await apiGet<{ count: number }>(`/practice/due-count?${params}`);
  return data.count;
}

export function previewNewWords(
  mode: PracticeMode,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean,
  limit: number,
  offset: number,
  reverse: boolean = false
): Promise<{ words: Word[]; total: number; learnedElsewhere: string[] }> {
  const params = new URLSearchParams({
    mode,
    limit: String(limit),
    offset: String(offset),
    characterMode: String(characterMode),
  });
  if (categories.length > 0) params.set('categories', categories.join(','));
  if (excludedCategories.length > 0) params.set('excludedCategories', excludedCategories.join(','));
  if (reverse) params.set('reverse', 'true');
  return apiGet(`/practice/preview?${params}`);
}

export function clearWordQueued(hanzi: string, characterMode: boolean): Promise<{ ok: boolean }> {
  return apiPost(`/words/${encodeURIComponent(hanzi)}/clear-queued`, { characterMode });
}

export function browseUnqueuedWords(
  mode: PracticeMode,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean,
  limit: number,
  offset: number
): Promise<{ words: Word[]; total: number }> {
  const params = new URLSearchParams({
    mode,
    limit: String(limit),
    offset: String(offset),
    characterMode: String(characterMode),
  });
  if (categories.length > 0) params.set('categories', categories.join(','));
  if (excludedCategories.length > 0) params.set('excludedCategories', excludedCategories.join(','));
  return apiGet(`/practice/unqueued?${params}`);
}

export function queueWords(hanzis: string[], characterMode: boolean): Promise<{ ok: boolean }> {
  return apiPost('/practice/queue-words', { hanzis, characterMode });
}

export function learnNow(
  hanzis: string[],
  mode: PracticeMode,
  characterMode: boolean
): Promise<{ ok: boolean }> {
  return apiPost('/practice/learn-now', { hanzis, mode, characterMode });
}

export function getCategories(): Promise<string[]> {
  return apiGet('/categories');
}

export async function getWordCount(): Promise<number> {
  const data = await apiGet<{ count: number }>('/words/count');
  return data.count;
}

export function updateWord(
  hanzi: string,
  pinyin: string,
  english: string[],
  polish: string[],
  categories: string[],
  queueAsNew: boolean,
  synonyms: string[],
  aiCategories: string[],
  aiEnglish: string[],
  aiNotes: string
): Promise<Word> {
  return apiPut(`/words/${encodeURIComponent(hanzi)}`, {
    pinyin,
    english,
    polish,
    categories,
    queueAsNew,
    synonyms,
    aiCategories,
    aiEnglish,
    aiNotes,
  });
}

export function suggestWords(query: string, limit: number): Promise<SynonymEntry[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return apiGet(`/words/suggest?${params}`);
}

export function inferWord(hanzi: string): Promise<InferResponse> {
  return apiPost('/words/infer', { hanzi });
}

export function lookupHanzi(
  hanzi: string
): Promise<LookupResponse> {
  return apiGet(`/words/lookup/${encodeURIComponent(hanzi)}`);
}

export function addWord(
  hanzi: string,
  pinyin: string,
  english: string[],
  polish: string[],
  categories: string[],
  queueAsNew: boolean,
  aiCategories: string[],
  aiEnglish: string[],
  aiNotes: string
): Promise<Word & { warnings?: string[] }> {
  return apiPost('/words', {
    hanzi,
    pinyin,
    english,
    polish,
    categories,
    queueAsNew,
    aiCategories,
    aiEnglish,
    aiNotes,
  });
}

export function makeProgressCharOnly(hanzi: string): Promise<{ ok: boolean; changed: number }> {
  return apiPost(`/words/${encodeURIComponent(hanzi)}/make-char-only`, {});
}

export function makeProgressWordMode(hanzi: string): Promise<{ ok: boolean; changed: number }> {
  return apiPost(`/words/${encodeURIComponent(hanzi)}/make-word-mode`, {});
}

export function regenerateAudio(hanzi: string): Promise<Word> {
  return apiPost(`/words/${encodeURIComponent(hanzi)}/regenerate-audio`, {});
}

export function regenerateExamples(hanzi: string): Promise<Word> {
  return apiPost(`/words/${encodeURIComponent(hanzi)}/regenerate-examples`, {});
}

export function resetWordProgress(hanzi: string, mode?: string): Promise<void> {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : '';
  return apiDelete(`/words/${encodeURIComponent(hanzi)}/progress${query}`);
}

export function resetWordBucket(hanzi: string, mode: string, toCharacterModeOnly = false): Promise<void> {
  return apiPost(`/words/${encodeURIComponent(hanzi)}/reset-bucket`, { mode, toCharacterModeOnly });
}

export function searchWords(
  hanzi: string,
  hanziMode: MatchMode,
  pinyin: string,
  pinyinMode: MatchMode,
  english: string
): Promise<SearchResult[]> {
  const params = new URLSearchParams();
  if (hanzi) {
    params.set('hanzi', hanzi);
    params.set('hanziMode', hanziMode);
  }
  if (pinyin) {
    params.set('pinyin', pinyin);
    params.set('pinyinMode', pinyinMode);
  }
  if (english) {
    params.set('english', english);
  }
  return apiGet(`/words/search?${params}`);
}

export async function assessSpeech(audio: ArrayBuffer, hanzi: string): Promise<SpeechAssessResponse> {
  const response = await fetch(
    `${API_BASE}/practice/speech-assess?hanzi=${encodeURIComponent(hanzi)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: audio }
  );
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || 'Speech assessment failed');
  }
  return response.json();
}

export function getSentenceQuestions(): Promise<SentenceQuestionsResponse> {
  return apiGet<SentenceQuestionsResponse>('/sentences/questions');
}

export function gradeSentence(hanzi: string, answer: string): Promise<SentenceGradeResponse> {
  return apiPost<SentenceGradeResponse>('/sentences/grade', { hanzi, answer });
}
