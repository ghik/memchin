import type {
  AnswerResponse,
  CedictEntry,
  CharacterInfo,
  CompleteResponse,
  LookupResponse,
  PracticeMode,
  PracticeQuestion,
  PracticeResult,
  SpeechAssessResponse,
  StartResponse,
  Stats,
  Word,
  WordProgress,
} from '../shared/types.js';

export type {
  CedictEntry,
  CharacterInfo,
  PracticeMode,
  PracticeQuestion,
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
  characterMode: boolean,
  hanziList?: string[]
): Promise<StartResponse> {
  return apiPost('/practice/start', {
    count,
    mode,
    wordSelection,
    categories,
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

export function getStats(categories: string[], charModes: PracticeMode[]): Promise<Stats[]> {
  const params = new URLSearchParams();
  if (categories.length > 0) params.set('categories', categories.join(','));
  if (charModes.length > 0) params.set('charModes', charModes.join(','));
  return apiGet(`/practice/stats?${params}`);
}

export function addHanziSynonym(hanzi: string, synonymHanzi: string): Promise<void> {
  return apiPost('/practice/hanzi-synonym', { hanzi, synonymHanzi });
}

export async function getDueCount(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean
): Promise<number> {
  const params = new URLSearchParams({ mode, characterMode: String(characterMode) });
  if (categories.length > 0) params.set('categories', categories.join(','));
  const data = await apiGet<{ count: number }>(`/practice/due-count?${params}`);
  return data.count;
}

export function previewNewWords(
  mode: PracticeMode,
  categories: string[],
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
  return apiGet(`/practice/preview?${params}`);
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
  categories: string[],
  resetBucket: boolean
): Promise<Word> {
  return apiPut(`/words/${encodeURIComponent(hanzi)}`, {
    pinyin,
    english,
    categories,
    resetBucket,
  });
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
  categories: string[],
  resetBucket: boolean
): Promise<Word> {
  return apiPost('/words', { hanzi, pinyin, english, categories, resetBucket });
}

export function resetWordProgress(hanzi: string, mode?: string): Promise<void> {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : '';
  return apiDelete(`/words/${encodeURIComponent(hanzi)}/progress${query}`);
}

export function resetWordBucket(hanzi: string, mode: string): Promise<void> {
  return apiPost(`/words/${encodeURIComponent(hanzi)}/reset-bucket`, { mode });
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
