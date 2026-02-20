import type {
  AnswerResponse,
  CedictEntry,
  CompleteResponse,
  PracticeMode,
  PracticeQuestion,
  PracticeResult,
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

export function getStats(categories: string[], characterMode: boolean): Promise<Stats[]> {
  const params = new URLSearchParams({ characterMode: String(characterMode) });
  if (categories.length > 0) params.set('categories', categories.join(','));
  return apiGet(`/practice/stats?${params}`);
}

export function markPinyinSynonym(hanzi: string, synonymPinyin: string): Promise<void> {
  return apiPost('/practice/synonym', { hanzi, synonymPinyin });
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
  count: number,
  categories: string[],
  characterMode: boolean
): Promise<Word[]> {
  const params = new URLSearchParams({
    mode,
    count: String(count),
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
  categories: string[]
): Promise<Word> {
  return apiPut(`/words/${encodeURIComponent(hanzi)}`, { pinyin, english, categories });
}

export function lookupHanzi(
  hanzi: string
): Promise<{ entries: CedictEntry[]; existing: Word | null }> {
  return apiGet(`/words/lookup/${encodeURIComponent(hanzi)}`);
}

export function addWord(
  hanzi: string,
  pinyin: string,
  english: string[],
  categories: string[]
): Promise<Word> {
  return apiPost('/words', { hanzi, pinyin, english, categories });
}

export function resetWordProgress(hanzi: string): Promise<void> {
  return apiDelete(`/words/${encodeURIComponent(hanzi)}/progress`);
}
