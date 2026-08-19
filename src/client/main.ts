import type {
  CharacterInfo,
  InferResponse,
  MatchMode,
  PracticeMode,
  PracticeQuestion,
  Progress,
  SearchResult,
  SynonymEntry,
  WordProgress,
  CedictEntry,
  Word,
} from './services.js';
import type { Example, Stats } from '../shared/types.js';
import {
  toNumberedPinyin,
  validatePinyin,
  stripTones,
  splitPinyinQuery,
  pinyinCandidateIndices,
  syllableMatchesToken,
  numberedToToneMarked,
} from '../shared/pinyin.js';
import type { PinyinToken } from '../shared/pinyin.js';
import {
  addHanziSynonym,
  addWord,
  assessSpeech,
  browseUnqueuedWords,
  searchWords,
  clearWordQueued,
  completePractice,
  getCategories,
  getStats,
  getWordCount,
  learnNow,
  inferWord,
  lookupHanzi,
  makeProgressCharOnly,
  makeProgressWordMode,
  previewNewWords,
  queueWords,
  regenerateAudio,
  regenerateExamples,
  resetWordBucket,
  resetWordProgress,
  startPractice,
  submitAnswer,
  suggestWords,
  updateWord,
} from './services.js';

// DOM Elements
const startScreen = document.getElementById('start-screen')!;
const practiceScreen = document.getElementById('practice-screen')!;
const resultScreen = document.getElementById('result-screen')!;
const addWordScreen = document.getElementById('add-word-screen')!;
const searchScreen = document.getElementById('search-screen')!;
const searchHanziInput = document.getElementById('search-hanzi') as HTMLInputElement;
const searchPinyinInput = document.getElementById('search-pinyin') as HTMLInputElement;
const searchEnglishInput = document.getElementById('search-english') as HTMLInputElement;
const searchResultsDiv = document.getElementById('search-results')!;
const hanziModeGroup = document.getElementById('hanzi-mode-group')!;
const pinyinModeGroup = document.getElementById('pinyin-mode-group')!;

const statsDiv = document.getElementById('stats')!;

const progressText = document.getElementById('progress-text')!;
const promptDiv = document.getElementById('prompt')!;
const answerInput = document.getElementById('answer-input') as HTMLInputElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
const feedbackDiv = document.getElementById('feedback')!;
const nextBtn = document.getElementById('next-btn')!;
const skipBtn = document.getElementById('skip-btn')!;

const practiceActions = document.getElementById('practice-actions')!;
const editWordBtn = document.getElementById('edit-word-btn')!;
const resetWordBtn = document.getElementById('reset-word-btn')!;
const cancelEditBtn = document.getElementById('cancel-edit-btn') as HTMLButtonElement;
const regenAudioBtn = document.getElementById('regen-audio-btn') as HTMLButtonElement;
const regenExamplesBtn = document.getElementById('regen-examples-btn') as HTMLButtonElement;
const makeCharOnlyBtn = document.getElementById('make-char-only-btn') as HTMLButtonElement;
const makeWordModeBtn = document.getElementById('make-word-mode-btn') as HTMLButtonElement;
const resetProgressBtn = document.getElementById('reset-progress-btn') as HTMLButtonElement;
const editOnlyBtns: HTMLButtonElement[] = [
  cancelEditBtn,
  resetProgressBtn,
  regenAudioBtn,
  regenExamplesBtn,
  makeCharOnlyBtn,
  makeWordModeBtn,
];

function setEditOnlyUiVisible(visible: boolean): void {
  for (const btn of editOnlyBtns) {
    btn.classList.toggle('hidden', !visible);
  }
  // Synonyms are stored per existing word, so they only apply while editing
  synonymsGroup.classList.toggle('hidden', !visible);
  if (!visible) {
    setSynonymValues([]);
    setProgressActionsEnabled(false, false);
  }
}

function setProgressActionsEnabled(hasProgress: boolean, isSingleChar: boolean): void {
  resetProgressBtn.disabled = !hasProgress;
  makeCharOnlyBtn.disabled = !hasProgress || !isSingleChar;
  makeWordModeBtn.disabled = !hasProgress || !isSingleChar;
}

function isSingleHanzi(s: string): boolean {
  // Count Unicode code points, not UTF-16 units, so CJK chars in the
  // supplementary plane (e.g. CJK Extension B) still count as one character.
  return [...s].length === 1;
}
const resultStatsDiv = document.getElementById('result-stats')!;
const mistakesSection = document.getElementById('mistakes-section')!;
const mistakesList = document.getElementById('mistakes-list')!;
const restartBtn = document.getElementById('restart-btn')!;
const categoryList = document.getElementById('category-list')!;
const categorySelected = document.getElementById('category-selected')!;
const categorySearch = document.getElementById('category-search') as HTMLInputElement;
const muteCheckbox = document.getElementById('mute-checkbox') as HTMLInputElement;
const audioVolumeInput = document.getElementById('audio-volume') as HTMLInputElement;
const audioVolumeValue = document.getElementById('audio-volume-value')!;

// Dark mode toggle
const themeCheckbox = document.getElementById('theme-checkbox') as HTMLInputElement;
const isDark = localStorage.getItem('theme') === 'dark';
document.body.classList.toggle('dark', isDark);
themeCheckbox.checked = isDark;
themeCheckbox.addEventListener('change', () => {
  document.body.classList.toggle('dark', themeCheckbox.checked);
  localStorage.setItem('theme', themeCheckbox.checked ? 'dark' : 'light');
});

// Sidebar nav
const navItems = document.querySelectorAll('.nav-item');
let currentView: 'practice' | 'search' | 'add-word' = 'practice';
let lastPracticeScreen: HTMLElement = startScreen;

const VIEW_PATHS: Record<string, 'practice' | 'search' | 'add-word'> = {
  '/': 'practice',
  '/explore': 'search',
  '/add': 'add-word',
};
const PATH_FOR_VIEW: Record<string, string> = {
  'practice': '/',
  'search': '/explore',
  'add-word': '/add',
};

function viewFromPath(): 'practice' | 'search' | 'add-word' {
  return VIEW_PATHS[location.pathname] ?? 'practice';
}

function showView(view: 'practice' | 'search' | 'add-word', push = true) {
  currentView = view;

  // Update nav active state
  navItems.forEach((item) => {
    item.classList.toggle('active', (item as HTMLElement).dataset.view === view);
  });

  // Hide all screens
  startScreen.classList.remove('active');
  practiceScreen.classList.remove('active');
  resultScreen.classList.remove('active');
  addWordScreen.classList.remove('active');
  searchScreen.classList.remove('active');

  if (view === 'practice') {
    lastPracticeScreen.classList.add('active');
    reloadStats();
  } else if (view === 'search') {
    searchScreen.classList.add('active');
    searchHanziInput.focus();
    restoreSearchFromUrl();
  } else if (view === 'add-word') {
    addWordScreen.classList.add('active');
    ensureCurated();
    renderChips(categoryChips, categoryValues, removeCategoryChip);
  }

  if (push) {
    const url = view === 'search' ? buildSearchUrl() : PATH_FOR_VIEW[view];
    if (location.pathname + location.search !== url) {
      history.pushState(null, '', url);
    }
  }
}

function buildSearchUrl(): string {
  const params = new URLSearchParams();
  const h = searchHanziInput.value.trim();
  const p = searchPinyinInput.value.trim();
  const e = searchEnglishInput.value.trim();
  if (h) {
    params.set('hanzi', h);
  }
  if (hanziMode !== 'contains') {
    params.set('hanziMode', hanziMode);
  }
  if (p) {
    params.set('pinyin', p);
  }
  if (pinyinMode !== 'contains') {
    params.set('pinyinMode', pinyinMode);
  }
  if (e) {
    params.set('english', e);
  }
  const qs = params.toString();
  return '/explore' + (qs ? '?' + qs : '');
}

function restoreSearchFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const h = params.get('hanzi') ?? '';
  const p = params.get('pinyin') ?? '';
  const e = params.get('english') ?? '';
  const hm = params.get('hanziMode');
  const pm = params.get('pinyinMode');
  searchHanziInput.value = h;
  searchPinyinInput.value = p;
  searchEnglishInput.value = e;
  if (hm && ['prefix', 'contains', 'suffix', 'exact'].includes(hm)) {
    hanziMode = hm as MatchMode;
    hanziModeGroup.querySelectorAll('.match-mode-btn').forEach((b) =>
      b.classList.toggle('active', (b as HTMLElement).dataset.mode === hm));
  }
  if (pm && ['prefix', 'contains', 'suffix', 'exact'].includes(pm)) {
    pinyinMode = pm as MatchMode;
    pinyinModeGroup.querySelectorAll('.match-mode-btn').forEach((b) =>
      b.classList.toggle('active', (b as HTMLElement).dataset.mode === pm));
  }
  if (h || p || e) {
    triggerSearch(true);
  }
}

function updateSearchUrl(): void {
  if (currentView === 'search') {
    const url = buildSearchUrl();
    if (location.pathname + location.search !== url) {
      history.pushState(null, '', url);
    }
  }
}

window.addEventListener('popstate', () => {
  const view = viewFromPath();
  showView(view, false);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentView === 'practice') {
    reloadStats();
  }
});

window.addEventListener('focus', () => {
  if (currentView === 'practice') {
    reloadStats();
  }
});

navItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const view = (item as HTMLElement).dataset.view as 'practice' | 'search' | 'add-word';
    if (view === 'practice') {
      returnToPractice = false;
      cancelEditBtn.classList.add('hidden');
    }
    showView(view);
  });
});

// Load preferences from localStorage
muteCheckbox.checked = localStorage.getItem('audioMuted') === 'true';
muteCheckbox.addEventListener('change', () => {
  localStorage.setItem('audioMuted', String(muteCheckbox.checked));
});

let audioVolume = (() => {
  const stored = parseInt(localStorage.getItem('audioVolume') ?? '100', 10);
  return Number.isFinite(stored) ? Math.min(100, Math.max(0, stored)) : 100;
})();
audioVolumeInput.value = String(audioVolume);
audioVolumeValue.textContent = `${audioVolume}%`;
audioVolumeInput.addEventListener('input', () => {
  audioVolume = parseInt(audioVolumeInput.value, 10);
  audioVolumeValue.textContent = `${audioVolume}%`;
  localStorage.setItem('audioVolume', String(audioVolume));
  if (muteCheckbox.checked) {
    muteCheckbox.checked = false;
    localStorage.setItem('audioMuted', 'false');
  }
});

categorySearch.addEventListener('input', filterCategoryList);
const ALL_MODES: PracticeMode[] = ['hanzi2pinyin', 'english2pinyin', 'english2hanzi'];

const savedWordCounts: Record<string, number> = JSON.parse(localStorage.getItem('wordCounts') ?? '{}');
const savedCardCollapsed: Record<string, boolean> = JSON.parse(localStorage.getItem('cardCollapsed') ?? '{}');
function getCardCollapsed(key: string): boolean {
  return savedCardCollapsed[key] ?? false;
}
function setCardCollapsed(key: string, collapsed: boolean) {
  savedCardCollapsed[key] = collapsed;
  localStorage.setItem('cardCollapsed', JSON.stringify(savedCardCollapsed));
}
function modeKey(mode: PracticeMode, charMode: boolean): string {
  return charMode ? `${mode}:char` : mode;
}
function parseCardKey(key: string): { mode: PracticeMode; cm: boolean } {
  if (key.endsWith(':char')) {
    return { mode: key.slice(0, -5) as PracticeMode, cm: true };
  }
  return { mode: key as PracticeMode, cm: false };
}
function getModeWordCount(mode: PracticeMode, charMode: boolean, selection?: string): number {
  const key = selection ? `${modeKey(mode, charMode)}:${selection}` : modeKey(mode, charMode);
  return savedWordCounts[key] ?? 10;
}
function setModeWordCount(mode: PracticeMode, charMode: boolean, count: number, selection?: string) {
  const key = selection ? `${modeKey(mode, charMode)}:${selection}` : modeKey(mode, charMode);
  savedWordCounts[key] = count;
  localStorage.setItem('wordCounts', JSON.stringify(savedWordCounts));
}


// State
let latestStats: Stats[] = [];
let currentMode: PracticeMode =
  (localStorage.getItem('mode') as PracticeMode) || 'hanzi2pinyin';
let questions: PracticeQuestion[] = [];
let currentIndex = 0;
let results: Map<string, number> = new Map(); // hanzi -> round answered correctly (1 = first try)
let allQuestions: PracticeQuestion[] = []; // original question list for results display
let incorrectThisRound: PracticeQuestion[] = [];
let roundNumber = 1;
let submitBlocked = false;
let nextBlocked = false;
let nextBlockedTimer: ReturnType<typeof setTimeout> | null = null;
let newWords: Set<string> = new Set(); // words that were new (bucket null) and shown answer on first round
let characterMode = false; // whether current session uses character mode

// Speech recording state
let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let recordedSamples: Float32Array[] = [];
let isRecording = false;
let recordingTimeout: ReturnType<typeof setTimeout> | null = null;

function encodePcm16(samples: Float32Array[]): ArrayBuffer {
  let totalLength = 0;
  for (const chunk of samples) totalLength += chunk.length;

  const pcmData = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of samples) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      pcmData[offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }

  return pcmData.buffer;
}

function finishRecording() {
  if (!isRecording) return;
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }
  answerInput.classList.remove('recording');
  stopRecording().then((wav) => {
    pendingAudioData = wav;
    answerInput.classList.add('has-audio');
  });
}

async function startRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);
  scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
  recordedSamples = [];

  scriptProcessor.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    recordedSamples.push(new Float32Array(data));
  };

  source.connect(scriptProcessor);
  scriptProcessor.connect(audioContext.destination);
  isRecording = true;
  recordingTimeout = setTimeout(finishRecording, 5000);
}

async function stopRecording(): Promise<ArrayBuffer> {
  isRecording = false;
  scriptProcessor?.disconnect();
  scriptProcessor = null;
  mediaStream?.getTracks().forEach((t) => t.stop());
  mediaStream = null;

  audioContext?.close();
  audioContext = null;

  return encodePcm16(recordedSamples);
}

function isPinyinMode(): boolean {
  return currentMode === 'hanzi2pinyin' || currentMode === 'english2pinyin';
}


// Session persistence
function saveSession() {
  sessionStorage.setItem('practiceSession', JSON.stringify({
    currentMode,
    characterMode,
    questions,
    allQuestions,
    currentIndex,
    results: [...results.entries()],
    newWords: [...newWords],
    incorrectThisRound,
    roundNumber,
  }));
}

function clearSession() {
  sessionStorage.removeItem('practiceSession');
}

function restoreSession(): boolean {
  const raw = sessionStorage.getItem('practiceSession');
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    currentMode = data.currentMode;
    characterMode = data.characterMode ?? false;
    questions = data.questions;
    allQuestions = data.allQuestions;
    currentIndex = data.currentIndex;
    results = new Map(data.results);
    newWords = new Set(data.newWords);
    incorrectThisRound = data.incorrectThisRound;
    roundNumber = data.roundNumber;
    showScreen(practiceScreen);
    showQuestion();
    return true;
  } catch {
    clearSession();
    return false;
  }
}

// Utility functions
function showScreen(screen: HTMLElement) {
  startScreen.classList.remove('active');
  practiceScreen.classList.remove('active');
  resultScreen.classList.remove('active');
  addWordScreen.classList.remove('active');
  screen.classList.add('active');
  lastPracticeScreen = screen;
}

function formatNextEligible(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff < 60_000) return '< 1m';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86400_000) return `${Math.round(diff / 3600_000)}h`;
  return `${Math.round(diff / 86400_000)}d`;
}

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const MODE_LABELS: Record<PracticeMode, string> = {
  hanzi2pinyin: 'Hanzi → Pinyin',
  english2hanzi: 'English → Hanzi',
  english2pinyin: 'English → Pinyin',
};

// Category selection state
const savedCategories = localStorage.getItem('selectedCategories');
let selectedCategories: Set<string> = savedCategories
  ? new Set(JSON.parse(savedCategories))
  : new Set();
const savedExcludedCategories = localStorage.getItem('excludedCategories');
let excludedCategories: Set<string> = savedExcludedCategories
  ? new Set(JSON.parse(savedExcludedCategories))
  : new Set();

function persistCategoryFilters(): void {
  localStorage.setItem('selectedCategories', JSON.stringify([...selectedCategories]));
  localStorage.setItem('excludedCategories', JSON.stringify([...excludedCategories]));
}

function hasCategoryFilter(): boolean {
  return selectedCategories.size > 0 || excludedCategories.size > 0;
}

function toggleCategory(cat: string, checked: boolean) {
  if (checked) {
    selectedCategories.add(cat);
    excludedCategories.delete(cat);
  } else {
    selectedCategories.delete(cat);
  }
  persistCategoryFilters();
  refreshCategoryItemStates();
  sortCategoryList();
  // Filter change can shrink the result set — drop back to page 0 so we don't
  // land past the new last page.
  browseOffset = 0;
  previewOffset = 0;
  reloadStats();
}

function excludeCategory(cat: string): void {
  if (excludedCategories.has(cat)) {
    excludedCategories.delete(cat);
  } else {
    excludedCategories.add(cat);
    if (selectedCategories.delete(cat)) {
      // Reflect the unchecked state in the master list checkbox.
      const cb = categoryList.querySelector<HTMLInputElement>(
        `input[type="checkbox"][value="${CSS.escape(cat)}"]`
      );
      if (cb) {
        cb.checked = false;
      }
    }
  }
  persistCategoryFilters();
  refreshCategoryItemStates();
  sortCategoryList();
  browseOffset = 0;
  previewOffset = 0;
  reloadStats();
}

function refreshCategoryItemStates(): void {
  for (const item of Array.from(categoryList.children) as HTMLElement[]) {
    const cb = item.querySelector('input') as HTMLInputElement | null;
    if (!cb) {
      continue;
    }
    item.classList.toggle('excluded', excludedCategories.has(cb.value));
  }
}

function filterCategoryList() {
  const query = categorySearch.value.toLowerCase();
  for (const item of Array.from(categoryList.children) as HTMLElement[]) {
    const value = (item.querySelector('input') as HTMLInputElement).value.toLowerCase();
    item.classList.toggle('hidden', query !== '' && !value.includes(query));
  }
}

function sortCategoryList() {
  // Rebuild the selected-categories section from clones (included + excluded)
  categorySelected.innerHTML = '';
  for (const item of Array.from(categoryList.children) as HTMLElement[]) {
    const checkbox = item.querySelector('input') as HTMLInputElement;
    const value = checkbox.value;
    if (checkbox.checked) {
      const clone = document.createElement('label');
      clone.className = 'category-item';
      const cloneCb = document.createElement('input');
      cloneCb.type = 'checkbox';
      cloneCb.value = value;
      cloneCb.checked = true;
      cloneCb.addEventListener('change', () => {
        checkbox.checked = false;
        toggleCategory(value, false);
      });
      clone.appendChild(cloneCb);
      clone.appendChild(document.createTextNode(value));
      clone.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        excludeCategory(value);
      });
      categorySelected.appendChild(clone);
    } else if (excludedCategories.has(value)) {
      const clone = document.createElement('label');
      clone.className = 'category-item excluded';
      const cloneCb = document.createElement('input');
      cloneCb.type = 'checkbox';
      cloneCb.value = value;
      cloneCb.checked = false;
      clone.appendChild(cloneCb);
      clone.appendChild(document.createTextNode(value));
      // Clicking the chip (or its checkbox) removes the exclusion.
      const remove = (e: Event) => {
        e.preventDefault();
        excludeCategory(value);
      };
      clone.addEventListener('click', remove);
      clone.addEventListener('contextmenu', remove);
      categorySelected.appendChild(clone);
    }
  }
  filterCategoryList();
}

// Load stats on start
async function loadStats() {
  try {
    const [stats, totalWords, categories] = await Promise.all([
      getStats(getSelectedCategories(), getExcludedCategories()),
      getWordCount(),
      getCategories(),
    ]);
    allCategoriesList = categories;

    // Populate category checkboxes
    categoryList.innerHTML = '';
    categorySelected.innerHTML = '';
    for (const cat of categories) {
      const label = document.createElement('label');
      label.className = 'category-item';
      if (excludedCategories.has(cat)) {
        label.classList.add('excluded');
      }
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = cat;
      checkbox.checked = selectedCategories.has(cat);
      checkbox.addEventListener('change', () => toggleCategory(cat, checkbox.checked));
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(cat));
      label.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        excludeCategory(cat);
      });
      categoryList.appendChild(label);
    }
    sortCategoryList();

    if (totalWords === 0) {
      statsDiv.innerHTML =
        '<p>No words in database. Run <code>npm run import-hsk</code> first.</p>';
      return;
    }

    renderStats(stats);
  } catch (error) {
    console.error('Failed to load stats:', error);
    statsDiv.innerHTML = '<p>Failed to load stats</p>';
  }
}

const BUCKET_LABELS = ['now', '5m', '30m', '4h', '1d', '3d', '7d', '14d', '30d', '60d'];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function makeBucketTimings(s: Stats): string {
  return s.buckets.map((_, i) => `<span class="bucket-timing">${BUCKET_LABELS[i] ?? ''}</span>`).join('');
}

function makeBucketBar(s: Stats): string {
  return s.buckets.map((count, i) => {
    const due = s.dueBuckets[i] || 0;
    const dueLabel = due > 0 ? `<span class="bucket-due">${due}</span> ` : '';
    return `<span class="bucket-count" title="Bucket ${i}: ${count} total, ${due} due">${dueLabel}${count}</span>`;
  }).join('');
}

function makeForecastTimings(): string {
  const today = new Date();
  const labels: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    labels.push(i === 0 ? 'today' : WEEKDAY_LABELS[d.getDay()]);
  }
  return labels.map((l) => `<span class="bucket-timing">${l}</span>`).join('');
}

function makeForecastBar(s: Stats): string {
  const today = new Date();
  return (s.dueByDay ?? []).map((count, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dayLabel = i === 0 ? 'today' : d.toDateString();
    const cls = count > 0 ? 'bucket-count forecast-count' : 'bucket-count forecast-count forecast-empty';
    return `<span class="${cls}" title="${dayLabel}: ${count} due">${count}</span>`;
  }).join('');
}

function updateStatsInPlace(stats: Stats[]): void {
  for (const s of stats) {
    const card = statsDiv.querySelector(`.mode-card[data-key="${modeKey(s.mode, s.characterMode)}"]`);
    if (!card) {
      return;
    }
    card.querySelector('.mode-card-stats')!.textContent = `${s.learned} learned`;
    card.querySelector('.bucket-timings:not(.forecast-timings)')!.innerHTML = makeBucketTimings(s);
    card.querySelector('.bucket-bar:not(.forecast-bar)')!.innerHTML = makeBucketBar(s);
    card.querySelector('.forecast-timings')!.innerHTML = makeForecastTimings();
    card.querySelector('.forecast-bar')!.innerHTML = makeForecastBar(s);
    const dueBtn = card.querySelector('.due-mode-btn') as HTMLButtonElement;
    dueBtn.textContent = `${s.dueForReview} due`;
    dueBtn.disabled = s.dueForReview === 0;
    dueBtn.dataset.count = String(s.dueForReview);
    dueBtn.classList.toggle('filtered', hasCategoryFilter());
    const previewBtn = card.querySelector('.mode-preview-btn') as HTMLButtonElement;
    previewBtn.textContent = `${s.newWordsCount} new`;
    previewBtn.disabled = s.newWordsCount === 0;
    previewBtn.classList.toggle('filtered', hasCategoryFilter());
  }
  latestStats = stats;

  // Reload open browse/preview sections with the user's current page intact.
  if (browseMode) {
    loadBrowsePage(browseOffset);
  }
  if (previewMode) {
    loadPreviewPage(previewOffset);
  }
}

async function renderStats(stats: Stats[]) {
  stats = [...stats].sort((a, b) => {
    const mi = ALL_MODES.indexOf(a.mode) - ALL_MODES.indexOf(b.mode);
    if (mi !== 0) return mi;
    return (a.characterMode ? 1 : 0) - (b.characterMode ? 1 : 0);
  });
  const html = stats
    .map((s) => {
      const cm = s.characterMode;
      const cardKey = modeKey(s.mode, cm);
      const bucketTimings = makeBucketTimings(s);
      const bucketBar = makeBucketBar(s);
      const forecastTimings = makeForecastTimings();
      const forecastBar = makeForecastBar(s);
      const filtered = hasCategoryFilter() ? ' filtered' : '';
      const dueBtn = `<button class="due-mode-btn${filtered}" data-mode="${s.mode}" data-charmode="${cm}" data-count="${s.dueForReview}" ${s.dueForReview === 0 ? 'disabled' : ''}>${s.dueForReview} due</button>`;
      const previewBtn = `<button class="mode-preview-btn${filtered}${previewMode === cardKey ? ' active' : ''}" data-mode="${s.mode}" data-charmode="${cm}" ${s.newWordsCount === 0 ? 'disabled' : ''}>${s.newWordsCount} new</button>`;
      const browseBtn = `<button class="mode-browse-btn${browseMode === cardKey ? ' active' : ''}" data-mode="${s.mode}" data-charmode="${cm}">Browse</button>`;
      const presets = [10, 20, 30, 40, 50];
      const reviewCount = getModeWordCount(s.mode, cm, 'review');
      const randomCount = getModeWordCount(s.mode, cm, 'random');
      const actionRow = (sel: string, btnClass: string, label: string, count: number, extra = '') => {
        return `<div class="mode-card-actions action-row-${sel}">
          <span class="action-btn-combo ${btnClass}">
            <button class="${btnClass} action-btn-label" data-mode="${s.mode}" data-charmode="${cm}">${label}</button>
            <input type="number" class="count-input" data-mode="${s.mode}" data-charmode="${cm}" data-sel="${sel}" value="${count}" min="1" max="999">
          </span>
          ${presets.map((n) => `<button class="count-preset" data-mode="${s.mode}" data-charmode="${cm}" data-sel="${sel}" data-count="${n}">${n}</button>`).join('')}
          ${extra}
        </div>`;
      };
      const reviewRow = actionRow('review', 'mode-review-btn', 'Review', reviewCount);
      const randomRow = actionRow('random', 'mode-random-btn', 'Random', randomCount);
      const label = `${MODE_LABELS[s.mode] ?? s.mode} <span class="mode-card-scope">(${cm ? 'characters' : 'words'})</span>`;
      const collapsed = getCardCollapsed(cardKey);
      return `
      <div class="mode-card${collapsed ? ' collapsed' : ''}" data-mode="${s.mode}" data-charmode="${cm}" data-key="${cardKey}">
        <div class="mode-card-header">
          <strong>${label}</strong>
          <span class="mode-card-stats">${s.learned} learned</span>
        </div>
        <div class="mode-card-body">
          <div class="mode-card-body-inner">
          <div class="forecast-label">Due in next 7 days</div>
          <div class="bucket-timings forecast-timings">${forecastTimings}</div>
          <div class="bucket-bar forecast-bar">${forecastBar}</div>
          <div class="bucket-timings">${bucketTimings}</div>
          <div class="bucket-bar">${bucketBar}</div>
          <div class="mode-card-actions-pair">
            ${reviewRow}
            ${randomRow}
          </div>
          <div class="mode-card-actions">
            ${browseBtn}${previewBtn}${dueBtn}
          </div>
          <div class="preview-section hidden" data-key="${cardKey}"></div>
          <div class="browse-section hidden" data-key="${cardKey}"></div>
          </div>
        </div>
      </div>
    `;
    })
    .join('');

  statsDiv.innerHTML = html;
  latestStats = stats;

  // Collapsible headers
  statsDiv.querySelectorAll('.mode-card-header').forEach((header) => {
    header.addEventListener('click', () => {
      const card = header.closest('.mode-card') as HTMLElement;
      const key = card.dataset.key!;
      const collapsed = card.classList.toggle('collapsed');
      setCardCollapsed(key, collapsed);
    });
  });

  function cardCharMode(el: Element): boolean {
    return (el as HTMLElement).dataset.charmode === 'true';
  }

  // Review buttons
  statsDiv.querySelectorAll('.mode-review-btn.action-btn-label').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      const cm = cardCharMode(btn);
      currentMode = mode;
      characterMode = cm;
      localStorage.setItem('mode', mode);
      handleStart(undefined, 'review');
    });
  });

  // Random buttons
  statsDiv.querySelectorAll('.mode-random-btn.action-btn-label').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      const cm = cardCharMode(btn);
      currentMode = mode;
      characterMode = cm;
      localStorage.setItem('mode', mode);
      handleStart(undefined, 'random');
    });
  });



  // Due buttons — review all due words
  statsDiv.querySelectorAll('.due-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      const cm = cardCharMode(btn);
      const count = parseInt((btn as HTMLElement).dataset.count!);
      currentMode = mode;
      characterMode = cm;
      localStorage.setItem('mode', mode);
      handleStart(undefined, 'review', count);
    });
  });

  function setPreviewBtnActive(key: string | null) {
    statsDiv.querySelectorAll('.mode-preview-btn').forEach((b) => {
      b.classList.toggle('active', modeKey((b as HTMLElement).dataset.mode as PracticeMode, cardCharMode(b)) === key);
    });
  }
  function setBrowseBtnActive(key: string | null) {
    statsDiv.querySelectorAll('.mode-browse-btn').forEach((b) => {
      b.classList.toggle('active', modeKey((b as HTMLElement).dataset.mode as PracticeMode, cardCharMode(b)) === key);
    });
  }

  // Preview buttons (toggle)
  statsDiv.querySelectorAll('.mode-preview-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      const cm = cardCharMode(btn);
      const key = modeKey(mode, cm);
      const section = statsDiv.querySelector(`.preview-section[data-key="${key}"]`) as HTMLElement;
      if (previewMode === key) {
        // Toggle off
        section.classList.add('hidden');
        section.innerHTML = '';
        previewMode = null;
        previewSelected.clear();
        setPreviewBtnActive(null);
        return;
      }
      // Close any other open preview
      if (previewMode) {
        const prev = statsDiv.querySelector(`.preview-section[data-key="${previewMode}"]`) as HTMLElement;
        prev.classList.add('hidden');
        prev.innerHTML = '';
      }
      currentMode = mode;
      characterMode = cm;
      localStorage.setItem('mode', mode);
      previewSelected.clear();
      previewMode = key;
      setPreviewBtnActive(key);
      loadPreviewPage(0, btn as HTMLButtonElement);
    });
  });

  // Browse buttons (toggle)
  statsDiv.querySelectorAll('.mode-browse-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      const cm = cardCharMode(btn);
      const key = modeKey(mode, cm);
      const section = statsDiv.querySelector(`.browse-section[data-key="${key}"]`) as HTMLElement;
      if (browseMode === key) {
        section.classList.add('hidden');
        section.innerHTML = '';
        browseMode = null;
        browseSelected.clear();
        setBrowseBtnActive(null);
        return;
      }
      if (browseMode) {
        const prev = statsDiv.querySelector(`.browse-section[data-key="${browseMode}"]`) as HTMLElement;
        prev.classList.add('hidden');
        prev.innerHTML = '';
      }
      currentMode = mode;
      characterMode = cm;
      localStorage.setItem('mode', mode);
      browseSelected.clear();
      browseMode = key;
      setBrowseBtnActive(key);
      loadBrowsePage(0, btn as HTMLButtonElement);
    });
  });

  // Count inputs and preset buttons
  function updateModeCount(mode: PracticeMode, cm: boolean, sel: string, count: number) {
    setModeWordCount(mode, cm, count, sel);
    const card = statsDiv.querySelector(`.mode-card[data-mode="${mode}"][data-charmode="${cm}"]`)!;
    const input = card.querySelector(`.count-input[data-sel="${sel}"]`) as HTMLInputElement;
    input.value = String(count);
    const btnClass = sel === 'review' ? '.mode-review-btn' : '.mode-random-btn';
    const mainBtn = card.querySelector(`${btnClass}.action-btn-label`) as HTMLButtonElement;
    mainBtn.textContent = `${sel === 'review' ? 'Review' : 'Random'} ${count}`;
  }

  statsDiv.querySelectorAll('.count-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      const cm = cardCharMode(btn);
      const sel = (btn as HTMLElement).dataset.sel!;
      const count = parseInt((btn as HTMLElement).dataset.count!);
      currentMode = mode;
      characterMode = cm;
      localStorage.setItem('mode', mode);
      handleStart(undefined, sel === 'review' ? 'review' : 'random', count);
    });
  });

  statsDiv.querySelectorAll('.count-input').forEach((input) => {
    input.addEventListener('focus', () => {
      (input as HTMLInputElement).select();
    });
    input.addEventListener('change', () => {
      const mode = (input as HTMLElement).dataset.mode as PracticeMode;
      const cm = cardCharMode(input);
      const sel = (input as HTMLElement).dataset.sel!;
      updateModeCount(mode, cm, sel, parseInt((input as HTMLInputElement).value) || 10);
    });
  });

  // Restore open preview/browse sections after re-render
  // Use the key to restore currentMode/characterMode correctly regardless of what was last clicked
  const pending: Promise<void>[] = [];
  if (previewMode) {
    const parsed = parseCardKey(previewMode);
    currentMode = parsed.mode;
    characterMode = parsed.cm;
    pending.push(loadPreviewPage(previewOffset));
  }
  if (browseMode) {
    const parsed = parseCardKey(browseMode);
    currentMode = parsed.mode;
    characterMode = parsed.cm;
    pending.push(loadBrowsePage(browseOffset));
  }
  await Promise.all(pending);
}

async function reloadStats() {
  try {
    const stats = await getStats(getSelectedCategories(), getExcludedCategories());
    const sorted = [...stats].sort((a, b) => {
      const mi = ALL_MODES.indexOf(a.mode) - ALL_MODES.indexOf(b.mode);
      if (mi !== 0) return mi;
      return (a.characterMode ? 1 : 0) - (b.characterMode ? 1 : 0);
    });
    if (statsDiv.querySelector('.mode-card')) {
      updateStatsInPlace(sorted);
    } else {
      await renderStats(stats);
    }
  } catch (error) {
    console.error('Failed to reload stats:', error);
  }
}

function getSelectedCategories(): string[] {
  return Array.from(selectedCategories);
}

function getExcludedCategories(): string[] {
  return Array.from(excludedCategories);
}

// Start practice
async function handleStart(hanziList?: string[], wordSelection: string = 'review', countOverride?: number) {
  const count = countOverride ?? getModeWordCount(currentMode, characterMode, wordSelection);

  try {
    const selectedCategories = getSelectedCategories();
    const excludedCategoriesList = getExcludedCategories();
    const response = await startPractice(
      count,
      currentMode,
      wordSelection,
      selectedCategories,
      excludedCategoriesList,
      characterMode,
      hanziList
    );
    questions = shuffle(response.questions);
    allQuestions = [...questions];
    currentIndex = 0;
    results.clear();
    incorrectThisRound = [];
    roundNumber = 1;
    newWords.clear();

    closePreview();
    closeBrowse();

    showScreen(practiceScreen);
    showQuestion();
    saveSession();
  } catch (error) {
    alert(error instanceof Error ? error.message : 'Failed to start practice');
  }
}

// Audio playback
const audioCacheBust = new Map<string, number>();
function playAudio(hanzi: string) {
  if (muteCheckbox.checked) {
    return;
  }
  const v = audioCacheBust.get(hanzi);
  const url = `/audio/${encodeURIComponent(hanzi)}.mp3${v ? `?v=${v}` : ''}`;
  const audio = new Audio(url);
  const linear = audioVolume / 100;
  audio.volume = linear * linear * linear;
  audio.play().catch((err) => console.warn('Audio playback failed:', err));
}


// Make hanzi clickable for audio
function clickableHanzi(hanzi: string, className: string): string {
  return `<span class="${className} clickable-hanzi" data-hanzi="${hanzi}">${hanzi}</span>`;
}

function formatTranslations(english: string[]): string {
  const sep = '<span class="english-sep"> • </span>';
  return `<span class="translations">${english.map(renderFullTranslationItem).join(sep)}</span>`;
}

const TRANSLATION_TRUNCATE_ABOVE = 10;
const TRANSLATION_VISIBLE = 5;
const ITEM_TRUNCATE_ABOVE = 30;
const ITEM_VISIBLE = 20;

// CEDICT cross-references look like `忘不了[wang4 bu5 liao3]` or `無|无[wu2]`.
// Render them as a single clean reference: hanzi (simplified preferred) followed
// by tone-marked pinyin in a subtle pill, instead of dumping the raw bracketed
// numbered pinyin and the trad|simp pair inline.
const CEDICT_REF_RE = /(?:([一-鿿]+)(?:\|([一-鿿]+))?)?\[([a-zA-Z0-9: ]+)\]/g;

function formatCedictRefs(text: string): string {
  return text.replace(CEDICT_REF_RE, (_match, trad: string | undefined, simp: string | undefined, pinyin: string) => {
    let pretty: string;
    try {
      pretty = numberedToToneMarked(pinyin.trim());
    } catch {
      pretty = pinyin.trim();
    }
    const display = simp || trad;
    const hanziHtml = display ? `<span class="cedict-ref-hanzi">${display}</span>` : '';
    return `<span class="cedict-ref">${hanziHtml}<span class="cedict-ref-pinyin">${pretty}</span></span>`;
  });
}

// `Beijing dialect` must come before `dialect` so the longer match wins.
// Each pattern optionally consumes trailing whitespace so the badge doesn't
// leave a literal space next to its neighbor (CSS margin handles visual gap).
const BADGE_DEFS: Array<{ re: RegExp; label: string; tip: string }> = [
  { re: /^\(bound form\)\s*/i, label: 'bf', tip: 'bound form' },
  { re: /^\(idiom\)\s*/i, label: 'id', tip: 'idiom' },
  { re: /^\(Beijing dialect\)\s*/i, label: 'bj', tip: 'Beijing dialect' },
  { re: /^\(Cantonese\)\s*/i, label: 'can', tip: 'Cantonese' },
  { re: /^\(Taiwanese\)\s*/i, label: 'tw', tip: 'Taiwan usage' },
  { re: /^\(Tw\)\s*/, label: 'tw', tip: 'Taiwan usage' },
  { re: /^\(PRC\)\s*/, label: 'prc', tip: 'PRC (mainland) usage' },
  { re: /^\(literary\)\s*/i, label: 'lit', tip: 'literary' },
  { re: /^\(fig\.\)\s*/i, label: 'fig', tip: 'figurative' },
  { re: /^\(coll\.\)\s*/i, label: 'col', tip: 'colloquial' },
  { re: /^\(loanword\)\s*/i, label: 'lw', tip: 'loanword' },
  { re: /^\(old\)\s*/i, label: 'old', tip: 'old usage' },
  { re: /^\(dialect\)\s*/i, label: 'dia', tip: 'dialect' },
  { re: /^\(slang\)\s*/i, label: 'sl', tip: 'slang' },
  { re: /^\(archaic\)\s*/i, label: 'arc', tip: 'archaic' },
  { re: /^\(onom\.\)\s*/i, label: 'ono', tip: 'onomatopoeia' },
  { re: /^\(honorific\)\s*/i, label: 'hon', tip: 'honorific' },
  { re: /^\(polite\)\s*/i, label: 'pol', tip: 'polite' },
  { re: /^\(derog(?:atory|\.)\)\s*/i, label: 'der', tip: 'derogatory' },
  { re: /^\(vulgar\)\s*/i, label: 'vul', tip: 'vulgar' },
  { re: /^\(abbr\.\)\s*/i, label: 'abbr', tip: 'abbreviation' },
  { re: /^\(esp\.\)\s*/i, label: 'esp', tip: 'especially' },
  { re: /^\(neologism\)\s*/i, label: 'neo', tip: 'neologism' },
  { re: /^\(euph(?:emism|\.)\)\s*/i, label: 'eup', tip: 'euphemism' },
  { re: /^\(hist(?:orical|\.)\)\s*/i, label: 'hist', tip: 'historical' },
  { re: /^classifier for\s+/i, label: 'mw', tip: 'measure word for' },
  { re: /^CL:/, label: 'mw:', tip: 'classifier: takes measure word' },
];

type Segment = { type: 'badge'; label: string; tip: string } | { type: 'text'; text: string };

function tokenizeBadges(text: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let textStart = 0;
  while (i < text.length) {
    let matched: { label: string; tip: string; len: number } | null = null;
    const c = text[i];
    if (c === '(' || c === 'c' || c === 'C') {
      const sub = text.slice(i);
      for (const b of BADGE_DEFS) {
        const m = sub.match(b.re);
        if (m) {
          matched = { label: b.label, tip: b.tip, len: m[0].length };
          break;
        }
      }
    }
    if (matched) {
      if (textStart < i) {
        segments.push({ type: 'text', text: text.slice(textStart, i) });
      }
      segments.push({ type: 'badge', label: matched.label, tip: matched.tip });
      i += matched.len;
      textStart = i;
    } else {
      i++;
    }
  }
  if (textStart < text.length) {
    segments.push({ type: 'text', text: text.slice(textStart) });
  }
  return segments;
}

function renderSegment(seg: Segment): string {
  if (seg.type === 'badge') {
    return `<span class="grammar-badge" data-tip="${seg.tip}">${seg.label}</span>`;
  }
  return formatCedictRefs(seg.text);
}

function segmentLen(seg: Segment): number {
  return seg.type === 'badge' ? seg.label.length : seg.text.length;
}

function renderFullTranslationItem(text: string): string {
  const inner = tokenizeBadges(text).map(renderSegment).join('');
  return `<span class="translation-item">${inner}</span>`;
}

// Non-nested parenthetical group. Used to collapse the "( ... )" tail of a
// translation like "something (blah blah blah)" before resorting to a hard
// character cut.
const PAREN_RE = /\(([^()]+)\)/g;

// A common translation shape is "meaning (clarification)". When such an item is
// too long, prefer hiding just the parenthetical over chopping mid-word. Returns
// the rendered item if collapsing a single parenthetical brings it under budget,
// or null to let the caller fall back to character truncation. Among qualifying
// parentheticals we collapse the smallest one that suffices — only hide more
// than necessary when a single collapse isn't enough (then the caller truncates).
function tryParenCollapse(segments: Segment[], displayLen: number, fullText: string): string | null {
  let best: { si: number; open: number; closeEnd: number; save: number } | null = null;
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (seg.type !== 'text') {
      continue;
    }
    PAREN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PAREN_RE.exec(seg.text)) !== null) {
      // Hiding the whole "( ... )" group, so the savings include the parens.
      const save = m[0].length;
      if (displayLen - save > ITEM_TRUNCATE_ABOVE) {
        continue;
      }
      // Only collapse a parenthetical that is strictly a suffix of the whole
      // translation — nothing but whitespace may follow the closing paren.
      const closeEnd = m.index + save;
      const isSuffix =
        seg.text.slice(closeEnd).trim().length === 0 &&
        segments.slice(si + 1).every((s) => s.type === 'text' && s.text.trim().length === 0);
      if (!isSuffix) {
        continue;
      }
      // Skip if the whole translation is the parenthetical — collapsing it would
      // hide everything, leaving only "(…)". There must be real text before it.
      const hasTextBefore =
        seg.text.slice(0, m.index).trim().length > 0 ||
        segments.slice(0, si).some((s) => s.type === 'text' && s.text.trim().length > 0);
      if (!hasTextBefore) {
        continue;
      }
      if (!best || save < best.save) {
        best = { si, open: m.index, closeEnd: m.index + m[0].length, save };
      }
    }
  }
  if (!best) {
    return null;
  }
  const headParts: string[] = [];
  const tailParts: string[] = [];
  const suffixParts: string[] = [];
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (si < best.si) {
      headParts.push(renderSegment(seg));
      continue;
    }
    if (si > best.si) {
      suffixParts.push(renderSegment(seg));
      continue;
    }
    // The text segment carrying the collapsed parenthetical: hide the whole
    // "( ... )" group along with the space before it, so the collapsed form
    // reads "meaning(…)"; keep the text before it and any trailing text visible.
    const t = (seg as { type: 'text'; text: string }).text;
    let headEnd = best.open;
    while (headEnd > 0 && t[headEnd - 1] === ' ') {
      headEnd--;
    }
    headParts.push(formatCedictRefs(t.slice(0, headEnd)));
    tailParts.push(formatCedictRefs(t.slice(headEnd, best.closeEnd)));
    suffixParts.push(formatCedictRefs(t.slice(best.closeEnd)));
  }
  const fullAttr = fullText.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<span class="translation-item">${headParts.join('')}<button type="button" class="translation-item-more translation-item-paren" aria-expanded="false" data-tooltip="${fullAttr}">(…)</button><span class="translation-tail hidden">${tailParts.join('')}</span>${suffixParts.join('')}</span>`;
}

function formatTranslationItem(text: string): string {
  const segments = tokenizeBadges(text);
  const displayLen = segments.reduce((s, seg) => s + segmentLen(seg), 0);
  if (displayLen <= ITEM_TRUNCATE_ABOVE) {
    return `<span class="translation-item">${segments.map(renderSegment).join('')}</span>`;
  }
  const collapsed = tryParenCollapse(segments, displayLen, text);
  if (collapsed) {
    return collapsed;
  }
  const headParts: string[] = [];
  const tailParts: string[] = [];
  let acc = 0;
  let cut = false;
  for (const seg of segments) {
    if (cut) {
      tailParts.push(renderSegment(seg));
      continue;
    }
    const segLen = segmentLen(seg);
    if (acc + segLen <= ITEM_VISIBLE) {
      headParts.push(renderSegment(seg));
      acc += segLen;
      continue;
    }
    if (seg.type === 'badge') {
      // Atomic — keep it in the head and cut after.
      headParts.push(renderSegment(seg));
      cut = true;
      continue;
    }
    // Split text segment at nearest word boundary, snapping out of CEDICT refs.
    let sliceAt = ITEM_VISIBLE - acc;
    const space = seg.text.lastIndexOf(' ', sliceAt);
    if (space > sliceAt * 0.6) {
      sliceAt = space;
    }
    CEDICT_REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CEDICT_REF_RE.exec(seg.text)) !== null) {
      if (sliceAt > m.index && sliceAt < m.index + m[0].length) {
        sliceAt = m.index;
        break;
      }
    }
    // Push any space right before the cut into the hidden tail so the collapsed
    // form reads "head…" rather than "head …".
    while (sliceAt > 0 && seg.text[sliceAt - 1] === ' ') {
      sliceAt--;
    }
    headParts.push(formatCedictRefs(seg.text.slice(0, sliceAt)));
    tailParts.push(formatCedictRefs(seg.text.slice(sliceAt)));
    cut = true;
  }
  const fullAttr = text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<span class="translation-item">${headParts.join('')}<button type="button" class="translation-item-more" aria-expanded="false" data-tooltip="${fullAttr}">…</button><span class="translation-tail hidden">${tailParts.join('')}</span></span>`;
}

function formatTranslationsTruncated(items: string[]): string {
  const sep = '<span class="english-sep"> • </span>';
  if (items.length <= TRANSLATION_TRUNCATE_ABOVE) {
    return `<span class="translations">${items.map(formatTranslationItem).join(sep)}</span>`;
  }
  const first = items.slice(0, TRANSLATION_VISIBLE);
  const rest = items.slice(TRANSLATION_VISIBLE);
  const firstHtml = first.map(formatTranslationItem).join(sep);
  const restHtml = rest.map(formatTranslationItem).join(sep);
  return `<span class="translations">${firstHtml}<button type="button" class="translation-more" aria-expanded="false" title="Show ${rest.length} more">…</button><span class="translation-extra hidden">${sep}${restHtml}</span></span>`;
}

function formatPolish(polish: string[] | undefined): string {
  if (!polish || polish.length === 0) {
    return '';
  }
  return `<span class="translations polish">${polish.map((t) => `<span class="translation-item">${t}</span>`).join('<span class="english-sep"> • </span>')}</span>`;
}

// Format example hints for question (varies by mode)
function formatExampleHints(examples: Example[]): string {
  if (currentMode === 'english2hanzi' || currentMode === 'english2pinyin') {
    // english->X: show english only (to not give away the answer)
    return examples.map((ex) => `<span class="ex-english">${ex.english}</span>`).join('<br>');
  } else {
    // hanzi->X modes: show the example hanzi (not clickable — examples have no audio)
    return examples.map((ex) => `<span class="ex-hanzi">${ex.hanzi}</span>`).join('<br>');
  }
}

// Format full examples for answer
function formatExampleAnswers(examples: Example[]): string {
  return examples
    .map(
      (ex) =>
        `<span class="ex-hanzi">${ex.hanzi}</span> <span class="ex-pinyin">${ex.pinyin}</span> <span class="ex-english">— ${ex.english}</span>`
    )
    .join('<br>');
}

// Show current question
function showQuestion() {
  const question = questions[currentIndex];
  const word = question.word;
  progressText.textContent = `Question ${currentIndex + 1} of ${questions.length}`;

  // Show example hints alongside the question
  if (currentMode === 'english2hanzi' || currentMode === 'english2pinyin') {
    // english->X mode: show english prompt, no clickable hanzi
    const translationsHtml = formatTranslations(word.english);
    let promptHtml = translationsHtml + aiEnglishHtml(word);
    const polishHtml = formatPolish(word.polish);
    if (polishHtml) {
      promptHtml += `<div class="prompt-polish">${polishHtml}</div>`;
    }

    // Show categories
    if (hasCategoryTags(word)) {
      promptHtml += `<div class="prompt-categories">${categoryTagsHtml(word)}</div>`;
    }

    // Show frequency rank
    const rank = characterMode ? word.hanziFrequencyRank : word.wordFrequencyRank;
    if (rank != null) {
      promptHtml += `<div class="prompt-rank">rank #${rank}</div>`;
    }

    if (word.examples.length > 0) {
      promptHtml += `<div class="example-hint">${formatExampleHints(word.examples)}</div>`;
    }
    promptDiv.innerHTML = promptHtml;
  } else {
    // hanzi->X modes: show clickable hanzi prompt
    const clickablePrompt = clickableHanzi(word.hanzi, 'prompt-hanzi');
    const hanziRow = `<div class="hanzi-row"><div class="hanzi-standard">${clickablePrompt}</div><div class="hanzi-handwritten">${word.hanzi}</div></div>`;
    if (word.examples.length > 0) {
      promptDiv.innerHTML = `${hanziRow}<div class="example-hint">${formatExampleHints(word.examples)}</div>`;
    } else {
      promptDiv.innerHTML = hanziRow;
    }
  }
  promptDiv.className =
    currentMode === 'english2hanzi' || currentMode === 'english2pinyin'
      ? 'prompt english-prompt'
      : 'prompt';

  answerInput.value = '';
  answerInput.placeholder =
    currentMode === 'english2hanzi' ? 'Enter hanzi…' :
    currentMode === 'english2pinyin' || currentMode === 'hanzi2pinyin' ? 'Enter pinyin…' :
    'Enter English…';
  pendingAudioData = null;
  speechAttemptCount = 0;
  answerInput.classList.remove('has-audio', 'recording', 'assessing', 'invalid');
  if (validationTimer !== null) {
    clearTimeout(validationTimer);
    validationTimer = null;
  }

  if (question.bucket === null && !newWords.has(word.hanzi)) {
    // New word — show answer immediately for learning, will be quizzed next round
    newWords.add(word.hanzi);
    answerInput.disabled = true;
    feedbackDiv.classList.remove('hidden', 'correct', 'incorrect', 'synonym');
    feedbackDiv.classList.add('correct');
    feedbackDiv.innerHTML = `<div class="correct-answer">${formatFullAnswer(question)}</div>`;
    playAudio(question.word.hanzi);
    submitBtn.classList.add('hidden');
    skipBtn.classList.add('hidden');
    practiceActions.classList.remove('hidden');
    // Don't set results — will be retried in next round
    incorrectThisRound.push(question);
  } else {
    answerInput.disabled = false;
    answerInput.focus();
    feedbackDiv.classList.add('hidden');
    practiceActions.classList.add('hidden');
    submitBtn.classList.remove('hidden');
    skipBtn.classList.remove('hidden');
  }
}

// Format character breakdown as a collapsible tree
function formatTreeNodes(nodes: CharacterInfo[], isRoot: boolean): string {
  return nodes
    .map((node) => {
      const hanziClass = isRoot ? 'tree-hanzi-root' : 'tree-hanzi';
      const hanziSpan = `<span class="${hanziClass}${node.traditional ? ' tree-has-traditional' : ''}"><span class="tree-traditional">${node.traditional ?? ''}</span><span class="tree-simplified">${node.hanzi}</span></span>`;
      const hasAlternates = node.alternates && node.alternates.length > 0;
      const hasComponents = node.components.length > 0;
      const componentsToggle = hasComponents
        ? `<button type="button" class="tree-components-toggle" aria-expanded="false" title="Components">▶</button>`
        : `<span class="tree-components-toggle tree-toggle-placeholder" aria-hidden="true"></span>`;
      const altToggle = hasAlternates
        ? `<button type="button" class="tree-alt-toggle" aria-expanded="false" title="Other readings">▸</button>`
        : `<span class="tree-alt-toggle tree-toggle-placeholder" aria-hidden="true"></span>`;
      const label = `${componentsToggle}${hanziSpan}${altToggle}<span class="tree-pinyin">${node.pinyin}</span><span class="tree-meaning">${formatTranslationsTruncated(node.meaning)}</span>`;
      // Invisible mirror of the main row's leading elements so alt-row pinyin aligns under main pinyin.
      const altRowPrefix = hasAlternates
        ? `<span class="tree-prefix-mirror" aria-hidden="true">${componentsToggle}${hanziSpan}<button type="button" class="tree-alt-toggle" tabindex="-1">▸</button></span>`
        : '';
      const altBlock = hasAlternates
        ? `<div class="tree-alternates hidden">${node.alternates!
            .map(
              (a) =>
                `<div class="tree-alt">${altRowPrefix}<span class="tree-pinyin">${a.pinyin}</span><span class="tree-meaning">${formatTranslationsTruncated(a.meaning)}</span></div>`
            )
            .join('')}</div>`
        : '';
      const childrenBlock = hasComponents
        ? `<ul class="tree-children hidden">${formatTreeNodes(node.components, false)}</ul>`
        : '';
      return `<li class="tree-node${hasComponents ? '' : ' tree-leaf'}"><div class="tree-row">${label}</div>${altBlock}${childrenBlock}</li>`;
    })
    .join('');
}

function formatBreakdown(breakdown: CharacterInfo[]): string {
  if (breakdown.length === 0) return '';
  return `<ul class="breakdown-tree">${formatTreeNodes(breakdown, true)}</ul>`;
}

// Format full answer for display
function formatFullAnswer(question: PracticeQuestion): string {
  const word = question.word;
  const hanzi = clickableHanzi(word.hanzi, 'answer-hanzi');
  const pinyin = `<span class="answer-pinyin">${word.pinyin}</span>`;
  const english = `<span class="answer-english">${formatTranslations(word.english)}</span>`;
  const polishHtml = formatPolish(word.polish);
  const polishBlock = polishHtml ? `<div class="answer-polish">${polishHtml}</div>` : '';

  let result: string;
  if (currentMode === 'english2hanzi' || currentMode === 'english2pinyin') {
    // The translations were the question — repeating them in the answer adds nothing
    result = `${hanzi} ${pinyin}`;
  } else {
    // hanzi2pinyin: hanzi was the question, reveal pinyin and every translation
    result =
      `${pinyin}<div class="answer-english">${formatTranslations(word.english)}</div>` +
      `${aiEnglishHtml(word)}${polishBlock}`;
  }

  // Show categories
  if (hasCategoryTags(word)) {
    result += `<div class="answer-categories">${categoryTagsHtml(word)}</div>`;
  }

  // Show example answers
  if (word.examples.length > 0) {
    result += `<div class="example-sentence">${formatExampleAnswers(word.examples)}</div>`;
  }

  // Show character breakdown for multi-character words (at the bottom)
  if (word.breakdown && word.breakdown.length > 0) {
    result += formatBreakdown(word.breakdown);
  }

  // Show containing words (character mode)
  if (question.containingWords.length > 0) {
    const items = question.containingWords
      .map(
        (w) =>
          `<span class="containing-word">${clickableHanzi(w.hanzi, 'containing-hanzi')} <span class="containing-pinyin">(${w.pinyin})</span> <span class="containing-english">${w.english[0]}</span></span>`
      )
      .join('');
    result += `<div class="containing-words"><span class="containing-label">Words with ${word.hanzi}:</span>${items}</div>`;
  }

  // The usage note closes the answer, after everything it might refer to
  result += aiNotesHtml(word);

  return result;
}

// Show incorrect feedback with optional synonym button
function showIncorrectFeedback(question: PracticeQuestion, prefix?: string) {
  const showSynonymBtn = currentMode === 'english2hanzi' || currentMode === 'english2pinyin';
  const synonymBtn = showSynonymBtn
    ? `<button class="synonym-btn" id="synonym-btn">Synonym</button>`
    : '';
  const acceptBtn = `<button class="synonym-btn" id="accept-btn">Try again</button>`;
  const label = prefix ?? '✗ Incorrect';
  feedbackDiv.innerHTML = `${label}${synonymBtn}${acceptBtn}<div class="correct-answer">${formatFullAnswer(question)}</div>`;

  document.getElementById('accept-btn')!.addEventListener('click', () => {
    incorrectThisRound = incorrectThisRound.filter((q) => q !== question);
    results.delete(question.word.hanzi);
    feedbackDiv.classList.remove('incorrect');
    feedbackDiv.classList.add('synonym');
    feedbackDiv.innerHTML = `Try again!`;
    answerInput.value = '';
    answerInput.disabled = false;
    answerInput.focus();
    submitBtn.classList.remove('hidden');
    skipBtn.classList.remove('hidden');
    practiceActions.classList.add('hidden');

    submitBlocked = true;
    const unblock = () => { submitBlocked = false; };
    const timer = setTimeout(unblock, 1000);
    answerInput.addEventListener('input', () => { clearTimeout(timer); unblock(); }, { once: true });
    saveSession();
  });

  if (showSynonymBtn) {
    document.getElementById('synonym-btn')!.addEventListener('click', () => {
      feedbackDiv.innerHTML = `<div class="synonym-input-row"><div class="synonym-search-container"><input type="text" id="synonym-hanzi-input" placeholder="Search learned words by hanzi or pinyin" class="synonym-hanzi-input" autocomplete="off"><div id="synonym-hanzi-suggestions" class="category-suggestions synonym-suggestions hidden"></div></div><button id="synonym-confirm-btn" class="primary-btn">Confirm</button><button id="synonym-cancel-btn" class="secondary-btn">Cancel</button></div><div id="synonym-search-hint" class="synonym-search-hint hidden"></div>`;
      const synonymInput = document.getElementById('synonym-hanzi-input') as HTMLInputElement;
      const synonymDropdown = document.getElementById('synonym-hanzi-suggestions')!;
      const synonymHint = document.getElementById('synonym-search-hint')!;
      synonymInput.focus();

      const saveSynonym = async (synonymHanzi: string) => {
        try {
          await addHanziSynonym(question.word.hanzi, synonymHanzi);
          incorrectThisRound = incorrectThisRound.filter((q) => q !== question);
          results.delete(question.word.hanzi);
          feedbackDiv.classList.remove('incorrect');
          feedbackDiv.classList.add('synonym');
          feedbackDiv.innerHTML = `✓ Synonym saved. Try again!`;
          answerInput.value = '';
          answerInput.disabled = false;
          answerInput.focus();
          submitBtn.classList.remove('hidden');
          skipBtn.classList.remove('hidden');
          practiceActions.classList.add('hidden');

          submitBlocked = true;
          const unblock = () => { submitBlocked = false; };
          const timer = setTimeout(unblock, 1000);
          answerInput.addEventListener('input', () => { clearTimeout(timer); unblock(); }, { once: true });
        } catch (error) {
          console.error('Failed to save synonym:', error);
          feedbackDiv.innerHTML = `<span class="error">Failed to save synonym</span>`;
        }
      };

      const search = new SynonymSearch(synonymInput, synonymDropdown, {
        onSelect: (entry) => {
          synonymHint.classList.add('hidden');
          void saveSynonym(entry.hanzi);
        },
        excluded: () => [question.word.hanzi],
        onNoMatch: (query) => {
          synonymHint.textContent = `No learned word matches "${query}"`;
          synonymHint.classList.remove('hidden');
        },
      });

      document.getElementById('synonym-confirm-btn')!.addEventListener('click', () => {
        void search.confirm();
      });

      document.getElementById('synonym-cancel-btn')!.addEventListener('click', () => {
        // Re-render rather than restoring markup, so the buttons get listeners again
        showIncorrectFeedback(question, prefix);
      });
    });
  }
}

// Show "try again" feedback (synonym or low accuracy)
function showTryAgain(message: string) {
  feedbackDiv.classList.remove('hidden', 'correct', 'incorrect', 'synonym');
  feedbackDiv.classList.add('synonym');
  feedbackDiv.innerHTML = message;
}

// Show final feedback (correct, incorrect, or skip) with common post-feedback actions
function showFinalFeedback(question: PracticeQuestion, type: 'correct' | 'incorrect' | 'skip', label?: string) {
  feedbackDiv.classList.remove('hidden', 'correct', 'incorrect', 'synonym');

  if (type === 'correct') {
    feedbackDiv.classList.add('correct');
    feedbackDiv.innerHTML = `${label ?? '✓ Correct!'}<div class="correct-answer">${formatFullAnswer(question)}</div>`;
  } else if (type === 'incorrect') {
    feedbackDiv.classList.add('incorrect');
    showIncorrectFeedback(question, label);
  } else {
    feedbackDiv.classList.add('incorrect');
    feedbackDiv.innerHTML = `<div class="correct-answer">${formatFullAnswer(question)}</div>`;
  }

  playAudio(question.word.hanzi);
  submitBtn.classList.add('hidden');
  skipBtn.classList.add('hidden');
  practiceActions.classList.remove('hidden');
  answerInput.disabled = true;
  if (type === 'incorrect') {
    nextBlocked = true;
    if (nextBlockedTimer !== null) {
      clearTimeout(nextBlockedTimer);
    }
    nextBlockedTimer = setTimeout(() => { nextBlocked = false; nextBlockedTimer = null; }, 1000);
  }
  saveSession();
}

// Handle answer submission
async function handleSubmit() {
  const answer = answerInput.value.trim();
  if (!answer) return;

  const question = questions[currentIndex];

  function markInvalid() {
    answerInput.classList.add('invalid');
    answerInput.focus();
  }

  // Validate pinyin input for pinyin-answer modes
  if ((currentMode === 'hanzi2pinyin' || currentMode === 'english2pinyin') && !validatePinyin(answer)) {
    feedbackDiv.classList.remove('hidden', 'correct', 'incorrect', 'synonym');
    feedbackDiv.classList.add('incorrect');
    feedbackDiv.innerHTML = 'Not valid pinyin. Use tone marks (zhōng) or tone numbers (zhong1).';
    markInvalid();
    return;
  }

  // Validate hanzi input for hanzi-answer mode
  if (currentMode === 'english2hanzi' && !/\p{Script=Han}/u.test(answer)) {
    feedbackDiv.classList.remove('hidden', 'correct', 'incorrect', 'synonym');
    feedbackDiv.classList.add('incorrect');
    feedbackDiv.innerHTML = 'Answer must contain hanzi (Chinese characters).';
    markInvalid();
    return;
  }

  answerInput.classList.remove('invalid');

  try {
    submitBtn.disabled = true;
    const response = await submitAnswer(currentMode, question.word.hanzi, answer);

    if (response.synonym) {
      showTryAgain(`✓ "${answer}" is correct, but not the word I'm looking for. Try again!`);
      answerInput.focus();
      submitBtn.disabled = false;

      submitBlocked = true;
      const unblock = () => { submitBlocked = false; };
      const timer = setTimeout(unblock, 1000);
      answerInput.addEventListener('input', () => { clearTimeout(timer); unblock(); }, { once: true });
      return;
    }

    if (response.correct && !results.has(question.word.hanzi)) {
      results.set(question.word.hanzi, roundNumber);
    }
    if (!response.correct) {
      incorrectThisRound.push(question);
    }

    showFinalFeedback(question, response.correct ? 'correct' : 'incorrect');
  } catch (error) {
    alert(error instanceof Error ? error.message : 'Failed to submit answer');
  } finally {
    submitBtn.disabled = false;
  }
}

// Handle "I don't know" button
function handleSkip() {
  const question = questions[currentIndex];
  incorrectThisRound.push(question);
  showFinalFeedback(question, 'skip');
}

// Handle next question
function handleNext() {
  currentIndex++;

  if (currentIndex >= questions.length) {
    // Round complete
    if (incorrectThisRound.length > 0) {
      // Retry incorrect questions
      questions = shuffle(incorrectThisRound);
      incorrectThisRound = [];
      roundNumber++;
      currentIndex = 0;
      showQuestion();
      saveSession();
    } else {
      // All done
      finishPractice();
    }
  } else {
    showQuestion();
    saveSession();
  }
}

// Finish practice session
async function finishPractice() {
  clearSession();
  try {
    const resultArray = Array.from(results.entries()).map(([hanzi, round]) => {
      const isNew = newWords.has(hanzi);
      return {
        hanzi,
        correctFirstTry: isNew ? round === 2 : round === 1,
        incorrectCount: isNew ? round - 2 : round - 1,
      };
    });

    const response = await completePractice(
      currentMode,
      resultArray,
      characterMode
    );
    const progressMap = new Map(response.progress.map((p) => [p.hanzi, p]));

    // Show results
    const correctCount = resultArray.filter((r) => r.correctFirstTry).length;
    const incorrectCount = resultArray.length - correctCount;

    resultStatsDiv.innerHTML = `
      <p class="success">✓ ${correctCount} correct on first try</p>
      <p class="retry">✗ ${incorrectCount} needed retry</p>
    `;

    // Show all practiced words with attempt info
    mistakesSection.classList.remove('hidden');
    mistakesList.innerHTML = [...allQuestions]
      .sort((a, b) => {
        const rawRa = results.get(a.word.hanzi) ?? Infinity;
        const rawRb = results.get(b.word.hanzi) ?? Infinity;
        const ra = newWords.has(a.word.hanzi) && rawRa !== Infinity ? rawRa - 1 : rawRa;
        const rb = newWords.has(b.word.hanzi) && rawRb !== Infinity ? rawRb - 1 : rawRb;
        if (ra !== rb) return rb - ra;
        const pa = progressMap.get(a.word.hanzi)?.nextEligible ?? '';
        const pb = progressMap.get(b.word.hanzi)?.nextEligible ?? '';
        return pa < pb ? -1 : pa > pb ? 1 : 0;
      })
      .map((q) => {
        const round = results.get(q.word.hanzi);
        const prog = progressMap.get(q.word.hanzi);
        const isNew = newWords.has(q.word.hanzi);
        const firstTry = isNew ? round === 2 : round === 1;
        const label = firstTry
          ? '✓'
          : round !== undefined
            ? `try ${isNew ? round - 1 : round}`
            : '?';
        const className = firstTry ? 'result-correct' : 'result-retry';
        const bucketLabel = q.bucket === null ? 'new' : `B${q.bucket}`;
        const progressInfo = prog
          ? `<span class="progress-info">${bucketLabel} · ${formatNextEligible(prog.nextEligible)}</span>`
          : '';
        return `
        <li class="${className}">
          ${clickableHanzi(q.word.hanzi, 'hanzi')}
          <span class="details">(${q.word.pinyin}) - ${q.word.english[0]}${q.word.polish && q.word.polish.length > 0 ? ` / ${q.word.polish[0]}` : ''}</span>
          <span class="attempt-label">${label}</span>
          ${progressInfo}
        </li>`;
      })
      .join('');

    showScreen(resultScreen);
  } catch (error) {
    console.error('Failed to complete practice:', error);
    showScreen(resultScreen);
  }
}

// Handle restart
function handleRestart() {
  loadStats();
  showScreen(startScreen);
}

// Edit current word during practice
function editCurrentWord() {
  const question = questions[currentIndex];
  const word = question.word;

  // Populate the add-word form
  addHanziInput.value = word.hanzi;
  addPinyinInput.value = word.pinyin;
  englishList.setValues(word.english);
  polishList.setValues(word.polish ?? []);
  categoryValues = [...word.categories];
  ensureCurated();
  renderChips(categoryChips, categoryValues, removeCategoryChip);
  editingExistingWord = true;
  const alreadyQueued = Boolean(word.queuedAt) || question.bucket !== null;
  queueAsNewCb.checked = !alreadyQueued;
  setQueueAsNewDisabled(alreadyQueued);
  addWordBtn.textContent = 'Save';
  addWordStatus.classList.add('hidden');
  setSynonymValues([]);
  performHanziLookup(word.hanzi);

  returnToPractice = true;
  setEditOnlyUiVisible(true);
  showView('add-word');
  addPinyinInput.focus();
}

function editWordFromSearch(word: Word) {
  addHanziInput.value = word.hanzi;
  addPinyinInput.value = word.pinyin;
  englishList.setValues(word.english);
  polishList.setValues(word.polish ?? []);
  categoryValues = [...word.categories];
  ensureCurated();
  renderChips(categoryChips, categoryValues, removeCategoryChip);
  editingExistingWord = true;
  const alreadyQueued = Boolean(word.queuedAt);
  queueAsNewCb.checked = !alreadyQueued;
  setQueueAsNewDisabled(alreadyQueued);
  addWordBtn.textContent = 'Save';
  addWordStatus.classList.add('hidden');
  setSynonymValues([]);
  performHanziLookup(word.hanzi);
  returnToSearch = true;
  setEditOnlyUiVisible(true);
  showView('add-word');
  addPinyinInput.focus();
}

// Event listeners
const quitBtn = document.getElementById('quit-btn')!;

submitBtn.addEventListener('click', handleSubmit);
skipBtn.addEventListener('click', handleSkip);
nextBtn.addEventListener('click', handleNext);
restartBtn.addEventListener('click', handleRestart);
quitBtn.addEventListener('click', () => {
  clearSession();
  handleRestart();
});
const finishBtn = document.getElementById('finish-btn')!;
finishBtn.addEventListener('click', () => {
  finishPractice();
});
editWordBtn.addEventListener('click', editCurrentWord);
resetWordBtn.addEventListener('click', async () => {
  const question = questions[currentIndex];
  const hanzi = question.word.hanzi;
  try {
    if (question.bucket !== null) {
      const toCharacterModeOnly = question.word.hanzi.length === 1 && !characterMode;
      await resetWordBucket(hanzi, currentMode, toCharacterModeOnly);
    }
    // Remove this word from all remaining state
    questions = questions.filter((q, i) => i === currentIndex ? false : q.word.hanzi !== hanzi);
    incorrectThisRound = incorrectThisRound.filter((q) => q.word.hanzi !== hanzi);
    allQuestions = allQuestions.filter((q) => q.word.hanzi !== hanzi);
    results.delete(hanzi);
    newWords.delete(hanzi);
    // currentIndex now points to the next question (or past end) since we removed current
    if (currentIndex >= questions.length) {
      if (incorrectThisRound.length > 0) {
        questions = shuffle(incorrectThisRound);
        incorrectThisRound = [];
        roundNumber++;
        currentIndex = 0;
        showQuestion();
        saveSession();
      } else {
        finishPractice();
      }
    } else {
      showQuestion();
      saveSession();
    }
  } catch (error) {
    alert(error instanceof Error ? error.message : 'Failed to reset word');
  }
});

let pendingAudioData: ArrayBuffer | null = null;
let speechAssessing = false;
let speechAttemptCount = 0;

async function submitPendingAudio() {
  if (!pendingAudioData) return;
  const wavData = pendingAudioData;
  pendingAudioData = null;
  answerInput.classList.remove('has-audio');
  answerInput.classList.add('assessing');
  speechAssessing = true;
  const question = questions[currentIndex];

  try {
    speechAttemptCount++;
    const result = await assessSpeech(wavData, question.word.hanzi);
    const score = result.accuracyScore;
    const failThreshold = speechAttemptCount === 1 ? 0 : 30;

    if (result.synonym && score >= 50) {
      showTryAgain(`✓ "${result.synonym}" is correct, but not the word I'm looking for. Try again!`);
    } else if (score >= 50) {
      if (!results.has(question.word.hanzi)) {
        results.set(question.word.hanzi, roundNumber);
      }
      showFinalFeedback(question, 'correct', `✓ Correct! (accuracy: ${Math.round(score)}%)`);
    } else if (score >= failThreshold) {
      showTryAgain(`Accuracy: ${Math.round(score)}% — try again!`);
    } else {
      incorrectThisRound.push(question);
      showFinalFeedback(question, 'incorrect', `✗ Accuracy: ${Math.round(score)}%`);
    }
  } catch (error) {
    feedbackDiv.classList.remove('hidden', 'correct', 'incorrect', 'synonym');
    feedbackDiv.classList.add('incorrect');
    feedbackDiv.innerHTML = `Speech assessment failed: ${error instanceof Error ? error.message : 'unknown error'}`;
  } finally {
    answerInput.classList.remove('assessing');
    speechAssessing = false;
  }
}

function canStartRecording(): boolean {
  return (
    isPinyinMode() &&
    practiceScreen.classList.contains('active') &&
    !submitBtn.classList.contains('hidden') &&
    answerInput.value.trim() === '' &&
    !isRecording &&
    !speechAssessing
  );
}

// Hold spacebar to record, release to buffer audio, hold again to re-record
let validationTimer: ReturnType<typeof setTimeout> | null = null;
answerInput.addEventListener('input', (e) => {
  if ((e as InputEvent).isComposing) {
    return;
  }
  if (validationTimer !== null) {
    clearTimeout(validationTimer);
  }
  const val = answerInput.value.trim();
  if (!val) {
    answerInput.classList.remove('invalid');
    return;
  }
  validationTimer = setTimeout(() => {
    validationTimer = null;
    if (currentMode === 'hanzi2pinyin' || currentMode === 'english2pinyin') {
      answerInput.classList.toggle('invalid', !validatePinyin(val));
    } else if (currentMode === 'english2hanzi') {
      answerInput.classList.toggle('invalid', !/\p{Script=Han}/u.test(val));
    } else {
      answerInput.classList.remove('invalid');
    }
  }, 500);
});

answerInput.addEventListener('keydown', (e) => {
  if (e.key === ' ' && (canStartRecording() || isRecording)) {
    e.preventDefault();
    if (!isRecording) {
      pendingAudioData = null;
      answerInput.classList.remove('has-audio');
      startRecording()
        .then(() => {
          answerInput.classList.add('recording');
        })
        .catch((err) => console.error('Microphone access failed:', err));
    }
  }
});

answerInput.addEventListener('keyup', (e) => {
  if (e.key === ' ' && isRecording) {
    e.preventDefault();
    finishRecording();
  }
});

cancelEditBtn.addEventListener('click', () => {
  setEditOnlyUiVisible(false);
  if (returnToSearch) {
    returnToSearch = false;
    showView('search');
  } else if (returnToPractice) {
    returnToPractice = false;
    showView('practice');
  } else {
    addHanziInput.value = '';
    addHanziInput.dispatchEvent(new Event('input'));
    addHanziInput.focus();
  }
});

resetProgressBtn.addEventListener('click', async () => {
  const hanzi = addHanziInput.value.trim();
  if (!hanzi) return;

  try {
    await resetWordProgress(hanzi);
    setProgressActionsEnabled(false, isSingleHanzi(hanzi));
    showAddWordStatus(`Progress reset for "${hanzi}"`, 'success');

    if (returnToPractice) {
      // Remove this word from the practice round
      const removeHanzi = hanzi;
      questions = questions.filter((q) => q.word.hanzi !== removeHanzi);
      allQuestions = allQuestions.filter((q) => q.word.hanzi !== removeHanzi);
      incorrectThisRound = incorrectThisRound.filter((q) => q.word.hanzi !== removeHanzi);
      results.delete(removeHanzi);
      newWords.delete(removeHanzi);

      // After filtering, the next word shifted into currentIndex.
      // Decrement so that handleNext() lands on it after incrementing.
      currentIndex--;
      if (currentIndex < -1) currentIndex = -1;

      returnToPractice = false;
      setEditOnlyUiVisible(false);

      if (questions.length === 0) {
        // No questions left — finish the session
        showView('practice');
        finishPractice();
      } else {
        showView('practice');
      }
    }
  } catch (error) {
    showAddWordStatus(error instanceof Error ? error.message : 'Failed to reset progress', 'error');
  }
});

async function withButtonBusy<T>(btn: HTMLButtonElement, busyLabel: string, fn: () => Promise<T>): Promise<T | undefined> {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

regenAudioBtn.addEventListener('click', async () => {
  const hanzi = addHanziInput.value.trim();
  if (!hanzi) {
    return;
  }
  try {
    const updated = await withButtonBusy(regenAudioBtn, 'Regenerating…', () => regenerateAudio(hanzi));
    audioCacheBust.set(hanzi, Date.now());
    showAddWordStatus(`Regenerated audio for "${hanzi}"`, 'success');
  } catch (error) {
    showAddWordStatus(error instanceof Error ? error.message : 'Failed to regenerate audio', 'error');
  }
});

makeCharOnlyBtn.addEventListener('click', async () => {
  const hanzi = addHanziInput.value.trim();
  if (!hanzi) {
    return;
  }
  if (!isSingleHanzi(hanzi)) {
    showAddWordStatus('Char-only progress only applies to single characters', 'error');
    return;
  }
  try {
    const { changed } = await withButtonBusy(makeCharOnlyBtn, 'Updating…', () => makeProgressCharOnly(hanzi)) ?? { changed: 0 };
    makeCharOnlyBtn.disabled = true;
    if (changed > 0) {
      showAddWordStatus(`Marked ${changed} progress row${changed === 1 ? '' : 's'} char-only for "${hanzi}"`, 'success');
    } else {
      showAddWordStatus(`No word-mode progress to convert for "${hanzi}"`, 'success');
    }
    loadStats();
  } catch (error) {
    showAddWordStatus(error instanceof Error ? error.message : 'Failed to convert progress', 'error');
  }
});

makeWordModeBtn.addEventListener('click', async () => {
  const hanzi = addHanziInput.value.trim();
  if (!hanzi) {
    return;
  }
  if (!isSingleHanzi(hanzi)) {
    showAddWordStatus('Word-mode progress only applies to single characters', 'error');
    return;
  }
  try {
    const { changed } = await withButtonBusy(makeWordModeBtn, 'Updating…', () => makeProgressWordMode(hanzi)) ?? { changed: 0 };
    makeWordModeBtn.disabled = true;
    if (changed > 0) {
      showAddWordStatus(`Promoted ${changed} progress row${changed === 1 ? '' : 's'} to word mode for "${hanzi}"`, 'success');
    } else {
      showAddWordStatus(`No char-only progress to convert for "${hanzi}"`, 'success');
    }
    loadStats();
  } catch (error) {
    showAddWordStatus(error instanceof Error ? error.message : 'Failed to convert progress', 'error');
  }
});

regenExamplesBtn.addEventListener('click', async () => {
  const hanzi = addHanziInput.value.trim();
  if (!hanzi) {
    return;
  }
  try {
    const updated = await withButtonBusy(regenExamplesBtn, 'Regenerating…', () => regenerateExamples(hanzi));
    if (updated) {
      for (const q of [...questions, ...allQuestions, ...incorrectThisRound]) {
        if (q.word.hanzi === hanzi) {
          q.word.examples = updated.examples;
        }
      }
    }
    showAddWordStatus(`Regenerated examples for "${hanzi}"`, 'success');
  } catch (error) {
    showAddWordStatus(error instanceof Error ? error.message : 'Failed to regenerate examples', 'error');
  }
});

answerInput.addEventListener('keydown', (e) => {
  // Ignore Enter during IME composition (e.g. pinyin input)
  if (e.isComposing) return;
  if (isRecording) return;
  if (e.key === 'Enter' && !submitBtn.classList.contains('hidden') && !submitBlocked) {
    if (pendingAudioData) {
      e.stopPropagation();
      submitPendingAudio();
    } else if (answerInput.value.trim() === '') {
      handleSkip();
    } else {
      handleSubmit();
    }
    e.stopPropagation();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (currentView !== 'practice') return;
  if (e.key === 'Enter') {
    if (resultScreen.classList.contains('active')) {
      handleRestart();
    } else if (!practiceActions.classList.contains('hidden') && !nextBlocked) {
      handleNext();
    }
  }
});


// Pagination helpers shared by preview/browse
function paginationHtml(offset: number, count: number, total: number): string {
  const pageStart = offset + 1;
  const pageEnd = offset + count;
  const hasPrev = offset > 0;
  const hasNext = pageEnd < total;
  const pageSizeOpts = PAGE_SIZE_OPTIONS.map((n) =>
    `<option value="${n}"${n === pageSize ? ' selected' : ''}>${n} per page</option>`
  ).join('');
  return `<div class="preview-pagination">` +
    `<button class="pagination-prev secondary-btn" ${hasPrev ? '' : 'disabled'}>Prev</button>` +
    `<span class="preview-page-info">${pageStart}–${pageEnd} of ${total}</span>` +
    `<button class="pagination-next secondary-btn" ${hasNext ? '' : 'disabled'}>Next</button>` +
    `<select class="page-size-select">${pageSizeOpts}</select>` +
    `</div>`;
}

function bindPagination(section: Element, onPrev: () => void, onNext: () => void, onPageSize: (size: number) => void): void {
  section.querySelectorAll('.pagination-prev').forEach((b) => b.addEventListener('click', () => onPrev()));
  section.querySelectorAll('.pagination-next').forEach((b) => b.addEventListener('click', () => onNext()));
  section.querySelectorAll('.page-size-select').forEach((sel) => {
    sel.addEventListener('change', () => onPageSize(parseInt((sel as HTMLSelectElement).value, 10)));
  });
}

// Preview new words
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
let pageSize: number = (() => {
  const stored = parseInt(localStorage.getItem('pageSize') ?? '20', 10);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(stored) ? stored : 20;
})();
let previewSelected = new Set<string>();
let previewOffset = 0;
let previewTotal = 0;
let previewMode: string | null = null; // composite key from modeKey()
let previewReverse = localStorage.getItem('previewReverse') === 'true';

// Browse unqueued words
let browseSelected = new Set<string>();
let browseOffset = 0;
let browseTotal = 0;
let browseMode: string | null = null;

function updatePracticeSelectedBtn() {
  const section = getPreviewSection();
  if (!section) return;
  const count = previewSelected.size;
  const practiceBtn = section.querySelector('.practice-selected-btn') as HTMLButtonElement | null;
  if (practiceBtn) {
    practiceBtn.disabled = count === 0;
    practiceBtn.textContent = count === 0 ? 'Practice selected' : `Practice ${count} selected`;
  }
  const learnBtn = section.querySelector('.preview-learn-now-btn') as HTMLButtonElement | null;
  if (learnBtn) {
    learnBtn.disabled = count === 0;
    learnBtn.textContent = count === 0 ? 'Mark as known' : `Mark ${count} as known`;
  }
}

function getPreviewSection(): HTMLElement | null {
  if (!previewMode) return null;
  return statsDiv.querySelector(`.preview-section[data-key="${previewMode}"]`);
}

function closePreview() {
  if (!previewMode) return;
  const section = getPreviewSection();
  if (section) {
    section.classList.add('hidden');
    section.innerHTML = '';
  }
  previewMode = null;
  previewSelected.clear();
}

async function loadPreviewPage(offset: number, triggerBtn?: HTMLButtonElement) {
  const section = getPreviewSection();
  if (!section) return;
  previewOffset = offset;
  const originalLabel = triggerBtn?.textContent ?? null;
  const loadingTimer = triggerBtn
    ? setTimeout(() => { triggerBtn.textContent = 'Loading…'; }, 100)
    : null;
  try {
    const { words, total, learnedElsewhere } = await previewNewWords(
      currentMode,
      getSelectedCategories(),
      getExcludedCategories(),
      characterMode,
      pageSize,
      offset,
      previewReverse
    );
    previewTotal = total;

    const learnedSet = new Set(learnedElsewhere);
    const selectLearnedLabel = characterMode
      ? `Select ${learnedElsewhere.length} from word mode`
      : `Select ${learnedElsewhere.length} from other modes`;
    const selectLearnedHtml = learnedElsewhere.length > 0
      ? `<label class="preview-select-all"><input type="checkbox" class="select-learned-cb"> ${selectLearnedLabel}</label>`
      : '';

    if (total === 0) {
      section.innerHTML = '<p class="preview-empty">No new words available.</p>';
      section.classList.remove('hidden');
      return;
    }

    const pagerHtml = paginationHtml(offset, words.length, total);
    const reverseHtml = `<div class="preview-sort-toggle" role="group" aria-label="Sort order">
      <button class="preview-sort-opt${previewReverse ? '' : ' active'}" data-order="oldest">Oldest first</button>
      <button class="preview-sort-opt${previewReverse ? ' active' : ''}" data-order="newest">Newest first</button>
    </div>`;
    section.innerHTML =
      `<div class="preview-header"><label class="preview-select-all"><input type="checkbox" class="preview-select-all-cb"> Select all</label>${selectLearnedHtml}${reverseHtml}<button class="preview-learn-now-btn primary-btn" disabled>Mark as known</button><button class="practice-selected-btn primary-btn" disabled>Practice selected</button></div>` +
      pagerHtml +
      words
        .map((w) => {
          const ranks = [
            w.wordFrequencyRank != null ? `word #${w.wordFrequencyRank}` : null,
            w.hanziFrequencyRank != null ? `char #${w.hanziFrequencyRank}` : null,
          ]
            .filter(Boolean)
            .join(', ');
          const rankSpan = ranks ? ` <span class="preview-rank">${ranks}</span>` : '';
          const cats = hasCategoryTags(w)
            ? ` <span class="preview-categories">${categoryTagsHtml(w)}</span>`
            : '';
          const resetTag = `<button class="preview-dismiss-btn" data-hanzi="${w.hanzi}">✕</button>`;
          const checked = previewSelected.has(w.hanzi) ? 'checked' : '';
          const polishSpan = w.polish && w.polish.length > 0 ? ` <span class="preview-polish">${w.polish.join('; ')}</span>` : '';
          return `<label class="preview-word"><input type="checkbox" class="preview-checkbox" data-hanzi="${w.hanzi}" ${checked}> ${clickableHanzi(w.hanzi, 'preview-hanzi')} <span class="preview-pinyin">${w.pinyin}</span> <span class="preview-english">${w.english.join('; ')}</span>${polishSpan}${rankSpan}${cats}${resetTag}</label>`;
        })
        .join('') +
      pagerHtml;

    // Checkbox handlers
    const pageHanzis = words.map((w) => w.hanzi);
    const selectAllCb = section.querySelector('.preview-select-all-cb') as HTMLInputElement;
    selectAllCb.checked = pageHanzis.every((h) => previewSelected.has(h));

    // Individual checkbox handlers
    section.querySelectorAll('.preview-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        const input = cb as HTMLInputElement;
        const hanzi = input.dataset.hanzi!;
        if (input.checked) {
          previewSelected.add(hanzi);
        } else {
          previewSelected.delete(hanzi);
        }
        selectAllCb.checked = pageHanzis.every((h) => previewSelected.has(h));
        updatePracticeSelectedBtn();
      });
    });

    // Select all handler
    selectAllCb.addEventListener('change', async (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      if (checked) {
        const { words: allWords } = await previewNewWords(currentMode, getSelectedCategories(), getExcludedCategories(), characterMode, previewTotal, 0, previewReverse);
        allWords.forEach((w) => previewSelected.add(w.hanzi));
        section.querySelectorAll('.preview-checkbox').forEach((cb) => { (cb as HTMLInputElement).checked = true; });
      } else {
        previewSelected.clear();
        section.querySelectorAll('.preview-checkbox').forEach((cb) => { (cb as HTMLInputElement).checked = false; });
      }
      updatePracticeSelectedBtn();
    });

    // Practice selected handler
    section.querySelector('.practice-selected-btn')!.addEventListener('click', () => {
      handleStart([...previewSelected]);
    });

    // Learn now handler (adds selected words directly to bucket 0)
    section.querySelector('.preview-learn-now-btn')!.addEventListener('click', async () => {
      const hanzis = [...previewSelected];
      if (hanzis.length === 0) {
        return;
      }
      await learnNow(hanzis, currentMode, characterMode);
      previewSelected.clear();
      await loadPreviewPage(previewOffset);
      reloadStats();
    });

    // Dismiss (clear reset priority) handlers
    section.querySelectorAll('.preview-dismiss-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const hanzi = (btn as HTMLButtonElement).dataset.hanzi!;
        await clearWordQueued(hanzi, characterMode);
        loadPreviewPage(previewOffset);
      });
    });

    bindPagination(
      section,
      () => loadPreviewPage(Math.max(0, previewOffset - pageSize)),
      () => loadPreviewPage(previewOffset + pageSize),
      (size) => { pageSize = size; localStorage.setItem('pageSize', String(size)); loadPreviewPage(0); },
    );

    // Order toggle (segmented)
    section.querySelectorAll('.preview-sort-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wantReverse = (btn as HTMLElement).dataset.order === 'newest';
        if (wantReverse === previewReverse) {
          return;
        }
        previewReverse = wantReverse;
        localStorage.setItem('previewReverse', String(previewReverse));
        loadPreviewPage(0);
      });
    });

    // Select learned elsewhere handler
    const selectLearnedCb = section.querySelector('.select-learned-cb') as HTMLInputElement | null;
    if (selectLearnedCb) {
      selectLearnedCb.checked = learnedElsewhere.length > 0 && learnedElsewhere.every((h) => previewSelected.has(h));
      selectLearnedCb.addEventListener('change', () => {
        const checked = selectLearnedCb.checked;
        if (checked) {
          learnedElsewhere.forEach((h) => previewSelected.add(h));
        } else {
          learnedElsewhere.forEach((h) => previewSelected.delete(h));
        }
        section.querySelectorAll('.preview-checkbox').forEach((cb) => {
          const input = cb as HTMLInputElement;
          input.checked = previewSelected.has(input.dataset.hanzi!);
        });
        selectAllCb.checked = pageHanzis.every((h) => previewSelected.has(h));
        updatePracticeSelectedBtn();
      });
    }

    updatePracticeSelectedBtn();
    section.classList.remove('hidden');
  } catch (error) {
    console.error('Failed to preview words:', error);
  } finally {
    if (loadingTimer !== null) {
      clearTimeout(loadingTimer);
    }
    if (triggerBtn && originalLabel !== null) {
      triggerBtn.textContent = originalLabel;
    }
  }
}


function getBrowseSection(): HTMLElement | null {
  if (!browseMode) return null;
  return statsDiv.querySelector(`.browse-section[data-key="${browseMode}"]`);
}

function closeBrowse() {
  if (!browseMode) return;
  const section = getBrowseSection();
  if (section) {
    section.classList.add('hidden');
    section.innerHTML = '';
  }
  browseMode = null;
  browseSelected.clear();
}

function updateBrowseActionBtns() {
  const section = getBrowseSection();
  if (!section) return;
  const count = browseSelected.size;
  const practiceBtn = section.querySelector('.browse-practice-btn') as HTMLButtonElement | null;
  const queueBtn = section.querySelector('.browse-queue-btn') as HTMLButtonElement | null;
  const learnBtn = section.querySelector('.browse-learn-now-btn') as HTMLButtonElement | null;
  if (practiceBtn) {
    practiceBtn.disabled = count === 0;
    practiceBtn.textContent = count === 0 ? 'Practice selected' : `Practice ${count} selected`;
  }
  if (queueBtn) {
    queueBtn.disabled = count === 0;
    queueBtn.textContent = count === 0 ? 'Queue selected' : `Queue ${count} selected`;
  }
  if (learnBtn) {
    learnBtn.disabled = count === 0;
    learnBtn.textContent = count === 0 ? 'Mark as known' : `Mark ${count} as known`;
  }
}

async function loadBrowsePage(offset: number, triggerBtn?: HTMLButtonElement) {
  const section = getBrowseSection();
  if (!section) return;
  browseOffset = offset;
  const originalLabel = triggerBtn?.textContent ?? null;
  const loadingTimer = triggerBtn
    ? setTimeout(() => { triggerBtn.textContent = 'Loading…'; }, 100)
    : null;
  try {
    const { words, total } = await browseUnqueuedWords(
      currentMode,
      getSelectedCategories(),
      getExcludedCategories(),
      characterMode,
      pageSize,
      offset
    );
    browseTotal = total;

    if (total === 0) {
      section.innerHTML = '<p class="preview-empty">No words available to browse.</p>';
      section.classList.remove('hidden');
      return;
    }

    const pagerHtml = paginationHtml(offset, words.length, total);

    section.innerHTML =
      `<div class="preview-header"><label class="preview-select-all"><input type="checkbox" class="browse-select-all-cb"> Select all</label>` +
      `<div class="browse-action-btns"><button class="browse-queue-btn primary-btn" disabled>Queue selected</button>` +
      `<button class="browse-learn-now-btn primary-btn" disabled>Mark as known</button>` +
      `<button class="browse-practice-btn primary-btn" disabled>Practice selected</button></div></div>` +
      pagerHtml +
      words.map((w) => {
        const ranks = [
          w.wordFrequencyRank != null ? `word #${w.wordFrequencyRank}` : null,
          w.hanziFrequencyRank != null ? `char #${w.hanziFrequencyRank}` : null,
        ].filter(Boolean).join(', ');
        const rankSpan = ranks ? ` <span class="preview-rank">${ranks}</span>` : '';
        const cats = hasCategoryTags(w)
          ? ` <span class="preview-categories">${categoryTagsHtml(w)}</span>`
          : '';
        const checked = browseSelected.has(w.hanzi) ? 'checked' : '';
        const polishSpan = w.polish && w.polish.length > 0 ? ` <span class="preview-polish">${w.polish.join('; ')}</span>` : '';
        return `<label class="preview-word"><input type="checkbox" class="browse-checkbox" data-hanzi="${w.hanzi}" ${checked}> ${clickableHanzi(w.hanzi, 'preview-hanzi')} <span class="preview-pinyin">${w.pinyin}</span> <span class="preview-english">${w.english.join('; ')}</span>${polishSpan}${rankSpan}${cats}</label>`;
      }).join('') +
      pagerHtml;

    const pageHanzis = words.map((w) => w.hanzi);
    const selectAllCb = section.querySelector('.browse-select-all-cb') as HTMLInputElement;
    selectAllCb.checked = pageHanzis.every((h) => browseSelected.has(h));

    section.querySelectorAll('.browse-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        const input = cb as HTMLInputElement;
        const hanzi = input.dataset.hanzi!;
        if (input.checked) {
          browseSelected.add(hanzi);
        } else {
          browseSelected.delete(hanzi);
        }
        selectAllCb.checked = pageHanzis.every((h) => browseSelected.has(h));
        updateBrowseActionBtns();
      });
    });

    selectAllCb.addEventListener('change', async (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      if (checked) {
        const { words: allWords } = await browseUnqueuedWords(currentMode, getSelectedCategories(), getExcludedCategories(), characterMode, browseTotal, 0);
        allWords.forEach((w) => browseSelected.add(w.hanzi));
        section.querySelectorAll('.browse-checkbox').forEach((cb) => { (cb as HTMLInputElement).checked = true; });
      } else {
        browseSelected.clear();
        section.querySelectorAll('.browse-checkbox').forEach((cb) => { (cb as HTMLInputElement).checked = false; });
      }
      updateBrowseActionBtns();
    });

    section.querySelector('.browse-practice-btn')!.addEventListener('click', async () => {
      const hanzis = [...browseSelected];
      await queueWords(hanzis, characterMode);
      handleStart(hanzis);
    });

    section.querySelector('.browse-queue-btn')!.addEventListener('click', async () => {
      const hanzis = [...browseSelected];
      await queueWords(hanzis, characterMode);
      browseSelected.clear();
      loadBrowsePage(browseOffset);
      reloadStats();
    });

    section.querySelector('.browse-learn-now-btn')!.addEventListener('click', async () => {
      const hanzis = [...browseSelected];
      if (hanzis.length === 0) {
        return;
      }
      await learnNow(hanzis, currentMode, characterMode);
      browseSelected.clear();
      loadBrowsePage(browseOffset);
      reloadStats();
    });

    bindPagination(
      section,
      () => loadBrowsePage(Math.max(0, browseOffset - pageSize)),
      () => loadBrowsePage(browseOffset + pageSize),
      (size) => { pageSize = size; localStorage.setItem('pageSize', String(size)); loadBrowsePage(0); },
    );

    updateBrowseActionBtns();
    section.classList.remove('hidden');
  } catch (error) {
    console.error('Failed to browse words:', error);
  } finally {
    if (loadingTimer !== null) {
      clearTimeout(loadingTimer);
    }
    if (triggerBtn && originalLabel !== null) {
      triggerBtn.textContent = originalLabel;
    }
  }
}

// Click handler for audio playback on hanzi
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('clickable-hanzi')) {
    const hanzi = target.dataset.hanzi;
    if (hanzi) {
      playAudio(hanzi);
    }
  }
});

// Floating tooltip for per-item ellipsis buttons. Lives on <body> so it can escape
// the scrolling card and any other clip boundaries.
let activeTooltip: HTMLDivElement | null = null;

function hideTranslationTooltip(): void {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }
}

function showTranslationTooltip(target: HTMLElement): void {
  const text = target.dataset.tooltip;
  if (!text) {
    return;
  }
  hideTranslationTooltip();
  const tip = document.createElement('div');
  tip.className = 'translation-tooltip';
  tip.innerHTML = formatCedictRefs(text);
  document.body.appendChild(tip);
  const margin = 6;
  const btn = target.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let top = btn.top - tipRect.height - margin;
  if (top < margin) {
    top = btn.bottom + margin;
  }
  let left = btn.left + btn.width / 2 - tipRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
  activeTooltip = tip;
}

document.addEventListener('mouseover', (e) => {
  const target = e.target as HTMLElement;
  if (target && target.classList && target.classList.contains('translation-item-more')) {
    showTranslationTooltip(target);
  }
});

document.addEventListener('mouseout', (e) => {
  const target = e.target as HTMLElement;
  if (target && target.classList && target.classList.contains('translation-item-more')) {
    hideTranslationTooltip();
  }
});

// Stale positions if the underlying button moves — drop the tooltip on scroll.
window.addEventListener('scroll', hideTranslationTooltip, true);

// Floating big-character tooltip over a breakdown-tree hanzi span (simplified +
// traditional). Also portaled to body so it escapes the card's clip boundary.
let activeHanziTooltip: HTMLDivElement | null = null;
let activeHanziTooltipFor: HTMLElement | null = null;

function hideHanziTooltip(): void {
  if (activeHanziTooltip) {
    activeHanziTooltip.remove();
    activeHanziTooltip = null;
  }
  activeHanziTooltipFor = null;
}

function showHanziTooltip(hanziEl: HTMLElement): void {
  const trad = hanziEl.querySelector('.tree-traditional')?.textContent?.trim() ?? '';
  const simp = hanziEl.querySelector('.tree-simplified')?.textContent?.trim() ?? '';
  if (!simp) {
    return;
  }
  hideHanziTooltip();
  const tip = document.createElement('div');
  tip.className = 'char-tooltip';
  const parts: string[] = [];
  if (trad && trad !== simp) {
    parts.push(`<span class="char-tooltip-trad">${trad}</span>`);
  }
  parts.push(`<span class="char-tooltip-simp">${simp}</span>`);
  tip.innerHTML = parts.join('');
  document.body.appendChild(tip);
  const margin = 6;
  const r = hanziEl.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let top = r.top - tipRect.height - margin;
  if (top < margin) {
    top = r.bottom + margin;
  }
  let left = r.left + r.width / 2 - tipRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
  activeHanziTooltip = tip;
  activeHanziTooltipFor = hanziEl;
}

document.addEventListener('mouseover', (e) => {
  const target = e.target as HTMLElement;
  if (!target || !target.closest) {
    return;
  }
  // Only trigger when over a non-empty character slot; an empty traditional
  // slot is a layout placeholder and should not pop the tooltip.
  const slot = target.closest('.tree-simplified, .tree-traditional') as HTMLElement | null;
  if (!slot || !slot.textContent?.trim()) {
    return;
  }
  const hanziEl = slot.closest('.tree-hanzi, .tree-hanzi-root') as HTMLElement | null;
  if (!hanziEl || hanziEl === activeHanziTooltipFor) {
    return;
  }
  showHanziTooltip(hanziEl);
});

document.addEventListener('mouseout', (e) => {
  const target = e.target as HTMLElement;
  if (!target || !target.closest) {
    return;
  }
  const hanziEl = target.closest('.tree-hanzi, .tree-hanzi-root') as HTMLElement | null;
  if (!hanziEl || hanziEl !== activeHanziTooltipFor) {
    return;
  }
  // Don't close when moving between child spans of the same hanzi container.
  const related = e.relatedTarget as Node | null;
  if (related && hanziEl.contains(related)) {
    return;
  }
  hideHanziTooltip();
});

window.addEventListener('scroll', hideHanziTooltip, true);

// Delegated handlers for the per-node chevrons in breakdown trees. Each chevron
// toggles only its own sibling block within the same <li>, so the alternates
// and IDS-components subtrees expand independently.
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  let blockSelector: string | null = null;
  let scopeSelector = 'li.tree-node';
  if (target.classList.contains('tree-alt-toggle')) {
    blockSelector = ':scope > .tree-alternates';
  } else if (target.classList.contains('tree-components-toggle')) {
    blockSelector = ':scope > .tree-children';
  } else if (target.classList.contains('translation-more')) {
    blockSelector = ':scope > .translation-extra';
    scopeSelector = '.translations';
  } else if (target.classList.contains('translation-item-more')) {
    blockSelector = ':scope > .translation-tail';
    scopeSelector = '.translation-item';
  } else {
    return;
  }
  e.stopPropagation();
  e.preventDefault();
  const scope = target.closest(scopeSelector);
  if (!scope) {
    return;
  }
  const block = scope.querySelector(blockSelector) as HTMLElement | null;
  if (!block) {
    return;
  }
  const expanded = block.classList.toggle('hidden') === false;
  target.classList.toggle('expanded', expanded);
  target.setAttribute('aria-expanded', String(expanded));
  if (target.classList.contains('translation-item-paren')) {
    target.textContent = expanded ? '−' : '(…)';
  } else if (
    target.classList.contains('translation-more') ||
    target.classList.contains('translation-item-more')
  ) {
    target.textContent = expanded ? '−' : '…';
  }
});


// Add word form
const addWordForm = document.getElementById('add-word-screen')!;
const addHanziInput = document.getElementById('add-hanzi') as HTMLInputElement;
const addPinyinInput = document.getElementById('add-pinyin') as HTMLInputElement;
const addEnglishInput = document.getElementById('add-english') as HTMLInputElement;
const addPolishInput = document.getElementById('add-polish') as HTMLInputElement;
const addCategoriesInput = document.getElementById('add-categories') as HTMLInputElement;
const englishListEl = document.getElementById('english-list')!;
const polishListEl = document.getElementById('polish-list')!;
const categoryChips = document.getElementById('category-chips')!;
const synonymsGroup = document.getElementById('synonyms-group')!;
const synonymList = document.getElementById('synonym-list')!;
const synonymSuggestions = document.getElementById('synonym-suggestions')!;
const addSynonymInput = document.getElementById('add-synonym') as HTMLInputElement;
const cedictEntries = document.getElementById('cedict-entries')!;
const wordInfoDiv = document.getElementById('word-info')!;
const wordBreakdown = document.getElementById('word-breakdown')!;
const categorySuggestions = document.getElementById('category-suggestions')!;
const aiCategoryChips = document.getElementById('ai-category-chips')!;
const inferBtn = document.getElementById('infer-btn') as HTMLButtonElement;
const aiNotesInput = document.getElementById('ai-notes') as HTMLTextAreaElement;
const aiEnglishGroup = document.getElementById('ai-english-group')!;
const aiEnglishList = document.getElementById('ai-english-list')!;
const aiAssessment = document.getElementById('ai-assessment')!;
const addWordBtn = document.getElementById('add-word-btn') as HTMLButtonElement;
const addWordStatus = document.getElementById('add-word-status')!;
const queueAsNewCb = document.getElementById('queue-as-new-cb') as HTMLInputElement;
const queueAsNewLabel = document.getElementById('queue-as-new-label')!;

function setQueueAsNewDisabled(disabled: boolean) {
  queueAsNewCb.disabled = disabled;
  queueAsNewLabel.classList.toggle('disabled', disabled);
};

class TranslationList {
  values: string[] = [];
  private listEl: HTMLElement;
  private addInputEl: HTMLInputElement;
  private dragSrcIndex: number | null = null;
  private insertIndex: number | null = null;
  private stride = 0;
  private itemEls: HTMLElement[] = [];
  private draggableItem: HTMLElement | null = null;
  private isInferred: (value: string) => boolean;

  constructor(
    listEl: HTMLElement,
    addInputEl: HTMLInputElement,
    isInferred: (value: string) => boolean = () => false
  ) {
    this.listEl = listEl;
    this.addInputEl = addInputEl;
    this.isInferred = isInferred;
    addInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.add(addInputEl.value);
      }
    });
    document.addEventListener('mouseup', () => {
      if (this.draggableItem) {
        this.draggableItem.draggable = false;
        this.draggableItem = null;
      }
    });
    document.addEventListener('dragover', (e) => this.handleDragOver(e));
    document.addEventListener('drop', (e) => this.handleDrop(e));
  }

  setValues(values: string[]): void {
    this.values = [...values];
    this.addInputEl.value = '';
    this.render();
  }

  clear(): void {
    this.setValues([]);
  }

  add(value: string): void {
    const trimmed = value.trim();
    if (trimmed && !this.values.includes(trimmed)) {
      this.values.push(trimmed);
      this.render();
    }
    this.addInputEl.value = '';
  }

  private calcInsertIndex(clientY: number): number {
    for (let i = 0; i < this.itemEls.length; i++) {
      if (i === this.dragSrcIndex) {
        continue;
      }
      const rect = this.itemEls[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return this.values.length;
  }

  private applyTransforms(): void {
    const src = this.dragSrcIndex;
    const ins = this.insertIndex;
    if (src === null || ins === null) {
      return;
    }
    for (let i = 0; i < this.itemEls.length; i++) {
      if (i === src) {
        continue;
      }
      let shift = 0;
      if (ins > src && i > src && i < ins) {
        shift = -this.stride;
      } else if (ins < src && i >= ins && i < src) {
        shift = this.stride;
      }
      this.itemEls[i].style.transform = shift ? `translateY(${shift}px)` : '';
    }
  }

  private clearTransforms(): void {
    this.itemEls.forEach((el) => (el.style.transform = ''));
  }

  private handleDragOver(e: DragEvent): void {
    if (this.dragSrcIndex === null) {
      return;
    }
    e.preventDefault();
    const newIns = this.calcInsertIndex(e.clientY);
    if (newIns !== this.insertIndex) {
      this.insertIndex = newIns;
      this.applyTransforms();
    }
  }

  private handleDrop(e: DragEvent): void {
    if (this.dragSrcIndex === null) {
      return;
    }
    e.preventDefault();
    const src = this.dragSrcIndex;
    const ins = this.insertIndex;
    this.dragSrcIndex = null;
    this.insertIndex = null;
    if (ins === null || ins === src || ins === src + 1) {
      return;
    }
    const [moved] = this.values.splice(src, 1);
    this.values.splice(src < ins ? ins - 1 : ins, 0, moved);
    this.render();
  }

  private render(): void {
    this.listEl.innerHTML = '';
    this.itemEls.length = 0;

    this.values.forEach((val, i) => {
      const item = document.createElement('div');
      item.className = 'english-item';
      item.classList.toggle('ai-inferred', this.isInferred(val));
      this.itemEls.push(item);

      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '⠿';
      handle.addEventListener('mousedown', () => {
        item.draggable = true;
        this.draggableItem = item;
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'english-item-input';
      input.value = val;
      input.addEventListener('input', () => {
        this.values[i] = input.value;
        item.classList.toggle('ai-inferred', this.isInferred(input.value));
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'english-item-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        this.values.splice(i, 1);
        this.render();
      });

      item.addEventListener('dragstart', (e) => {
        this.dragSrcIndex = i;
        e.dataTransfer!.effectAllowed = 'move';
        if (this.itemEls.length > 1) {
          const a = this.itemEls[0].getBoundingClientRect().top;
          const b = this.itemEls[1].getBoundingClientRect().top;
          this.stride = b - a;
        } else {
          this.stride = item.offsetHeight;
        }
        setTimeout(() => item.classList.add('dragging'), 0);
      });
      item.addEventListener('dragend', () => {
        item.draggable = false;
        this.draggableItem = null;
        item.classList.remove('dragging');
        this.clearTransforms();
        this.dragSrcIndex = null;
        this.insertIndex = null;
      });

      item.append(handle, input, removeBtn);
      this.listEl.appendChild(item);
    });
  }
}

// Values the AI filled in, badged until the user edits them away
let inferredEnglish = new Set<string>();
let inferredPolish = new Set<string>();
let inferredPinyin: string | null = null;

const englishList = new TranslationList(englishListEl, addEnglishInput, (val) =>
  inferredEnglish.has(val)
);
const polishList = new TranslationList(polishListEl, addPolishInput, (val) =>
  inferredPolish.has(val)
);

let categoryValues: string[] = [];
let aiCategoryValues: string[] = [];
let aiEnglishValues: string[] = [];
let allCategoriesList: string[] = [];
let lookupTimer: ReturnType<typeof setTimeout> | null = null;
let editingExistingWord = false;
let returnToPractice = false;
let returnToSearch = false;

function ensureCurated() {
  if (!categoryValues.includes('curated')) {
    categoryValues.push('curated');
  }
}

function renderChips(container: HTMLElement, values: string[], onRemove: (index: number) => void) {
  container.innerHTML = '';
  values.forEach((val, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${val}<button type="button" class="chip-remove" data-index="${i}">×</button>`;
    chip.querySelector('.chip-remove')!.addEventListener('click', () => onRemove(i));
    container.appendChild(chip);
  });
}

function addCategoryChip(value: string) {
  const trimmed = value.trim();
  if (trimmed && !categoryValues.includes(trimmed)) {
    categoryValues.push(trimmed);
    renderChips(categoryChips, categoryValues, removeCategoryChip);
  }
  addCategoriesInput.value = '';
  categorySuggestions.classList.add('hidden');
}

function removeCategoryChip(index: number) {
  categoryValues.splice(index, 1);
  renderChips(categoryChips, categoryValues, removeCategoryChip);
}

function renderAiCategoryChips() {
  aiCategoryChips.innerHTML = '';
  aiCategoryChips.classList.toggle('hidden', aiCategoryValues.length === 0);
  aiCategoryValues.forEach((val, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip ai-chip';
    chip.title = 'Inferred by AI';
    chip.innerHTML = `<span class="ai-mark" aria-hidden="true">✨</span>${val}<button type="button" class="chip-remove">×</button>`;
    chip.querySelector('.chip-remove')!.addEventListener('click', () => {
      aiCategoryValues.splice(i, 1);
      renderAiCategoryChips();
    });
    aiCategoryChips.appendChild(chip);
  });
}

function setAiCategories(values: string[]) {
  aiCategoryValues = [...values];
  renderAiCategoryChips();
}

function renderAiEnglish() {
  aiEnglishGroup.classList.toggle('hidden', aiEnglishValues.length === 0);
  aiEnglishList.innerHTML = '';
  aiEnglishValues.forEach((value, i) => {
    const item = document.createElement('div');
    item.className = 'english-item ai-inferred';
    const text = document.createElement('span');
    text.className = 'ai-english-text';
    text.textContent = value;
    const promote = document.createElement('button');
    promote.type = 'button';
    promote.className = 'ai-english-promote';
    promote.title = 'Move to English';
    promote.textContent = '↑';
    promote.addEventListener('click', () => {
      englishList.add(value);
      aiEnglishValues.splice(i, 1);
      renderAiEnglish();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'english-item-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      aiEnglishValues.splice(i, 1);
      renderAiEnglish();
    });
    item.append(text, promote, remove);
    aiEnglishList.appendChild(item);
  });
}

function setAiEnglish(values: string[]) {
  aiEnglishValues = [...values];
  renderAiEnglish();
}

function setAiNotes(notes: string) {
  aiNotesInput.value = notes;
  aiNotesInput.classList.toggle('ai-inferred', notes.trim() !== '');
}

/** Drop the "filled in by AI" badges (the labels themselves are kept — they are stored) */
function clearInferMarks() {
  inferredEnglish = new Set();
  inferredPolish = new Set();
  inferredPinyin = null;
  addPinyinInput.classList.remove('ai-inferred');
  aiAssessment.classList.add('hidden');
  aiAssessment.innerHTML = '';
}

const VERDICT_LABEL: Record<InferResponse['verdict'], string> = {
  ok: 'Looks natural',
  unnatural: 'Unnatural',
  invalid: 'Not valid Chinese',
};

function renderAssessment(result: InferResponse) {
  aiAssessment.className = `ai-assessment ${result.verdict}`;
  aiAssessment.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'ai-assessment-header';
  header.innerHTML = `<span class="ai-mark" aria-hidden="true">✨</span><span class="ai-verdict">${VERDICT_LABEL[result.verdict]}</span>`;
  aiAssessment.appendChild(header);

  if (result.notes) {
    const notes = document.createElement('div');
    notes.className = 'ai-assessment-notes';
    notes.textContent = result.notes;
    aiAssessment.appendChild(notes);
  }

  if (result.suggestion) {
    const row = document.createElement('div');
    row.className = 'ai-assessment-suggestion';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'aux-btn';
    btn.textContent = `Use ${result.suggestion} instead`;
    btn.addEventListener('click', () => {
      addHanziInput.value = result.suggestion!;
      addHanziInput.dispatchEvent(new Event('input'));
      addHanziInput.focus();
    });
    row.appendChild(btn);
    aiAssessment.appendChild(row);
  }

  aiAssessment.classList.remove('hidden');
}

function mergeInferred(list: TranslationList, values: string[], marks: Set<string>) {
  const merged = [...list.values];
  for (const value of values) {
    marks.add(value);
    if (!merged.includes(value)) {
      merged.push(value);
    }
  }
  list.setValues(merged);
}

function applyInference(result: InferResponse) {
  setAiNotes(result.notes);
  addPinyinInput.value = result.pinyin;
  inferredPinyin = result.pinyin;
  addPinyinInput.classList.add('ai-inferred');

  // The inferred English stays in its own list, minus whatever the curated one already has
  // (the server dedupes on save too); Polish still merges into the curated list
  const known = new Set(englishList.values.map((value) => value.trim().toLowerCase()));
  setAiEnglish(result.english.filter((gloss) => !known.has(gloss.trim().toLowerCase())));
  mergeInferred(polishList, result.polish, inferredPolish);

  // Same rule the server applies on save: a label already on the word is not worth repeating
  const knownCategories = new Set(
    [...categoryValues, ...aiCategoryValues].map((value) => value.trim().toLowerCase())
  );
  for (const category of result.categories) {
    if (!knownCategories.has(category.trim().toLowerCase())) {
      knownCategories.add(category.trim().toLowerCase());
      aiCategoryValues.push(category);
    }
  }
  renderAiCategoryChips();
  renderAssessment(result);
}

addPinyinInput.addEventListener('input', () => {
  if (inferredPinyin !== null && addPinyinInput.value !== inferredPinyin) {
    inferredPinyin = null;
    addPinyinInput.classList.remove('ai-inferred');
  }
});

inferBtn.addEventListener('click', async () => {
  const hanzi = addHanziInput.value.trim();
  if (!hanzi) {
    showAddWordStatus('Type a word or sentence first', 'error');
    return;
  }
  try {
    const result = await withButtonBusy(inferBtn, 'Inferring…', () => inferWord(hanzi));
    if (result) {
      applyInference(result);
    }
  } catch (error) {
    showAddWordStatus(error instanceof Error ? error.message : 'Inference failed', 'error');
  }
});

const SYNONYM_SUGGESTION_LIMIT = 8;
const SYNONYM_SUGGEST_DEBOUNCE_MS = 200;

interface SynonymSearchOptions {
  onSelect: (entry: SynonymEntry) => void;
  /** Hanzi that must not be offered (the word itself, already-added synonyms) */
  excluded: () => string[];
  onNoMatch?: (query: string) => void;
}

/** Autocomplete over learned words, driven by hanzi or pinyin. */
class SynonymSearch {
  private items: SynonymEntry[] = [];
  private highlight = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private input: HTMLInputElement,
    private dropdown: HTMLElement,
    private options: SynonymSearchOptions
  ) {
    this.input.addEventListener('input', () => this.scheduleLoad());
    this.input.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.input.addEventListener('blur', () => {
      // Delay so a suggestion click still lands
      setTimeout(() => this.hide(), 150);
    });
  }

  clear(): void {
    this.input.value = '';
    this.hide();
  }

  hide(): void {
    this.items = [];
    this.highlight = -1;
    this.dropdown.classList.add('hidden');
  }

  /** Adds the highlighted suggestion, resolving a still-pending query first. */
  async confirm(): Promise<void> {
    const query = this.input.value.trim();
    if (!query) {
      return;
    }
    if (this.timer) {
      // Confirmed before the debounce fired — resolve the query first
      clearTimeout(this.timer);
      this.timer = null;
      await this.load(query);
    }
    const highlighted = this.items[this.highlight];
    if (highlighted) {
      this.clear();
      this.options.onSelect(highlighted);
    } else {
      this.options.onNoMatch?.(query);
    }
  }

  private scheduleLoad(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    const query = this.input.value.trim();
    if (!query) {
      this.hide();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load(query);
    }, SYNONYM_SUGGEST_DEBOUNCE_MS);
  }

  private async load(query: string): Promise<void> {
    try {
      const results = await suggestWords(query, SYNONYM_SUGGESTION_LIMIT * 2);
      if (this.input.value.trim() !== query) {
        // A newer keystroke already superseded this response
        return;
      }
      const excluded = this.options.excluded();
      this.items = results
        .filter((r) => !excluded.includes(r.hanzi))
        .slice(0, SYNONYM_SUGGESTION_LIMIT);
      this.highlight = this.items.length > 0 ? 0 : -1;
      this.render();
    } catch (error) {
      console.error('Synonym lookup failed:', error);
      this.hide();
    }
  }

  private render(): void {
    this.dropdown.innerHTML = '';
    if (this.items.length === 0) {
      this.hide();
      return;
    }
    this.items.forEach((entry, i) => {
      const div = document.createElement('div');
      div.className = 'category-suggestion synonym-suggestion';
      div.classList.toggle('active', i === this.highlight);

      const hanziEl = document.createElement('span');
      hanziEl.className = 'preview-hanzi';
      hanziEl.textContent = entry.hanzi;

      const pinyinEl = document.createElement('span');
      pinyinEl.className = 'preview-pinyin';
      pinyinEl.textContent = entry.pinyin;

      const englishEl = document.createElement('span');
      englishEl.className = 'preview-english';
      englishEl.textContent = entry.english.join('; ');

      div.append(hanziEl, pinyinEl, englishEl);
      // mousedown, not click: the input's blur handler would hide the list first
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.clear();
        this.options.onSelect(entry);
      });
      this.dropdown.appendChild(div);
    });
    this.dropdown.classList.remove('hidden');
  }

  private move(delta: number): void {
    if (this.items.length === 0) {
      return;
    }
    const count = this.items.length;
    this.highlight = (this.highlight + delta + count) % count;
    this.render();
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.move(-1);
    } else if (e.key === 'Escape') {
      this.hide();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Practice binds Enter globally to "next question"
      e.stopPropagation();
      void this.confirm();
    }
  }
}

let synonymValues: SynonymEntry[] = [];

function renderSynonymList() {
  synonymList.innerHTML = '';
  synonymValues.forEach((syn, i) => {
    const item = document.createElement('div');
    item.className = 'synonym-item';

    const hanziEl = document.createElement('span');
    hanziEl.className = 'preview-hanzi';
    hanziEl.textContent = syn.hanzi;

    const pinyinEl = document.createElement('span');
    pinyinEl.className = 'preview-pinyin';
    pinyinEl.textContent = syn.pinyin;

    const englishEl = document.createElement('span');
    englishEl.className = 'preview-english';
    englishEl.textContent = syn.english.join('; ');

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'synonym-item-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeSynonym(i));

    item.append(hanziEl, pinyinEl, englishEl, removeBtn);
    synonymList.appendChild(item);
  });
}

function setSynonymValues(values: SynonymEntry[]) {
  synonymValues = values;
  synonymSearch.clear();
  renderSynonymList();
}

function removeSynonym(index: number) {
  synonymValues.splice(index, 1);
  renderSynonymList();
}

function addSynonymEntry(entry: SynonymEntry) {
  if (entry.hanzi === addHanziInput.value.trim()) {
    showAddWordStatus('A word cannot be its own synonym', 'error');
    return;
  }
  if (!synonymValues.some((syn) => syn.hanzi === entry.hanzi)) {
    synonymValues.push(entry);
    renderSynonymList();
  }
  synonymSearch.clear();
}

const synonymSearch = new SynonymSearch(addSynonymInput, synonymSuggestions, {
  onSelect: (entry) => {
    addSynonymEntry(entry);
    addSynonymInput.focus();
  },
  excluded: () => [addHanziInput.value.trim(), ...synonymValues.map((syn) => syn.hanzi)],
  onNoMatch: (query) => showAddWordStatus(`No learned word matches "${query}"`, 'error'),
});

addCategoriesInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCategoryChip(addCategoriesInput.value);
  }
});

addCategoriesInput.addEventListener('input', () => {
  const query = addCategoriesInput.value.toLowerCase().trim();
  if (!query) {
    categorySuggestions.classList.add('hidden');
    return;
  }
  const matches = allCategoriesList.filter(
    (c) => c.toLowerCase().includes(query) && !categoryValues.includes(c)
  );
  if (matches.length === 0) {
    categorySuggestions.classList.add('hidden');
    return;
  }
  categorySuggestions.innerHTML = '';
  for (const cat of matches.slice(0, 8)) {
    const div = document.createElement('div');
    div.className = 'category-suggestion';
    div.textContent = cat;
    div.addEventListener('click', () => addCategoryChip(cat));
    categorySuggestions.appendChild(div);
  }
  categorySuggestions.classList.remove('hidden');
});

addCategoriesInput.addEventListener('blur', () => {
  // Delay to allow click on suggestion
  setTimeout(() => categorySuggestions.classList.add('hidden'), 150);
});

async function performHanziLookup(hanzi: string) {
  try {
    const { entries, existing, maxBucket, breakdown, wordRank, charRank, synonyms } =
      await lookupHanzi(hanzi);

    if (existing) {
      editingExistingWord = true;
      const alreadyQueued = Boolean(existing.queuedAt) || maxBucket !== null;
      queueAsNewCb.checked = !alreadyQueued;
      setQueueAsNewDisabled(alreadyQueued);
      addWordBtn.textContent = 'Save';
      setEditOnlyUiVisible(true);
      setSynonymValues(synonyms);
      setProgressActionsEnabled(maxBucket !== null, isSingleHanzi(existing.hanzi));
      addPinyinInput.value = existing.pinyin;
      englishList.setValues(existing.english);
      polishList.setValues(existing.polish ?? []);
      categoryValues = [...existing.categories];
      ensureCurated();
      renderChips(categoryChips, categoryValues, removeCategoryChip);
      setAiCategories(existing.aiCategories ?? []);
      setAiEnglish(existing.aiEnglish ?? []);
      setAiNotes(existing.aiNotes ?? '');
      clearInferMarks();

      const infoParts: string[] = [];
      if (wordRank != null) infoParts.push(`word #${wordRank}`);
      if (charRank != null) infoParts.push(`char #${charRank}`);
      infoParts.push(`Bucket: ${maxBucket ?? 'new'}`);
      wordInfoDiv.textContent = infoParts.join(' · ');
      wordInfoDiv.classList.remove('hidden');
    } else {
      editingExistingWord = false;
      queueAsNewCb.checked = true;
      setQueueAsNewDisabled(false);
      addWordBtn.textContent = 'Add';
      setEditOnlyUiVisible(false);
      addPinyinInput.value = '';
      addCategoriesInput.value = '';
      englishList.clear();
      polishList.clear();
      categoryValues = [];
      ensureCurated();
      renderChips(categoryChips, categoryValues, removeCategoryChip);
      setAiCategories([]);
      setAiEnglish([]);
      setAiNotes('');
      clearInferMarks();
      const rankParts: string[] = [];
      if (wordRank != null) rankParts.push(`word #${wordRank}`);
      if (charRank != null) rankParts.push(`char #${charRank}`);
      if (rankParts.length > 0) {
        wordInfoDiv.textContent = rankParts.join(' · ');
        wordInfoDiv.classList.remove('hidden');
      } else {
        wordInfoDiv.classList.add('hidden');
      }
    }

    // Show character breakdown
    const breakdownHtml = formatBreakdown(breakdown);
    if (breakdownHtml) {
      wordBreakdown.innerHTML = breakdownHtml;
      wordBreakdown.classList.remove('hidden');
    } else {
      wordBreakdown.classList.add('hidden');
    }

    if (entries.length === 0) {
      cedictEntries.classList.add('hidden');
      return;
    }
    renderCedictEntries(entries);
    cedictEntries.classList.remove('hidden');

    // Auto-fill from CEDICT only for new words
    if (!existing) {
      if (entries.length === 1) {
        addPinyinInput.value = entries[0].pinyin;
        englishList.setValues(entries[0].definitions);
      } else {
        const allSamePinyin = entries.every((e) => e.pinyin === entries[0].pinyin);
        if (allSamePinyin) {
          addPinyinInput.value = entries[0].pinyin;
        }
      }
    }
  } catch (error) {
    console.error('Lookup failed:', error);
  }
}

// Debounced CEDICT lookup + existing word check
addHanziInput.addEventListener('input', () => {
  if (lookupTimer) clearTimeout(lookupTimer);
  const hanzi = addHanziInput.value.trim();
  if (!hanzi) {
    addPinyinInput.value = '';
    addCategoriesInput.value = '';
    englishList.clear();
    polishList.clear();
    categoryValues = [];
    ensureCurated();
    renderChips(categoryChips, categoryValues, removeCategoryChip);
    setAiCategories([]);
    setAiEnglish([]);
    setAiNotes('');
    clearInferMarks();
    cedictEntries.classList.add('hidden');
    wordInfoDiv.classList.add('hidden');
    wordBreakdown.classList.add('hidden');
    editingExistingWord = false;
    queueAsNewCb.checked = true;
    setQueueAsNewDisabled(false);
    addWordBtn.textContent = 'Add';
    setEditOnlyUiVisible(false);
    return;
  }
  lookupTimer = setTimeout(() => performHanziLookup(hanzi), 300);
});

function renderCedictEntries(entries: CedictEntry[]) {
  cedictEntries.innerHTML = '';
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = 'cedict-entry';
    div.innerHTML = `<span class="cedict-pinyin">${entry.pinyin}</span><span class="cedict-defs">${entry.definitions.join('; ')}</span>`;
    div.addEventListener('click', () => {
      addPinyinInput.value = entry.pinyin;
      englishList.setValues(entry.definitions);
    });
    cedictEntries.appendChild(div);
  }
}

addWordBtn.addEventListener('click', async () => {
  const hanzi = addHanziInput.value.trim();
  const pinyin = addPinyinInput.value.trim();

  if (!hanzi || !pinyin || englishList.values.length === 0) {
    showAddWordStatus(
      'Please fill in hanzi, pinyin, and at least one English translation',
      'error'
    );
    return;
  }

  if (!validatePinyin(pinyin)) {
    showAddWordStatus(
      'Invalid pinyin. Use tone marks (zhōng) or tone numbers (zhong1).',
      'error'
    );
    return;
  }

  try {
    addWordBtn.disabled = true;
    addWordBtn.textContent = editingExistingWord ? 'Saving...' : 'Adding...';

    const englishValues = englishList.values;
    const polishValues = polishList.values;
    if (editingExistingWord) {
      const updated = await updateWord(
        hanzi,
        pinyin,
        englishValues,
        polishValues,
        categoryValues,
        queueAsNewCb.checked,
        synonymValues.map((syn) => syn.hanzi),
        aiCategoryValues,
        aiEnglishValues,
        aiNotesInput.value.trim()
      );
      showAddWordStatus(`Updated "${hanzi}" successfully!`, 'success');

      // Update word data in practice questions so display stays current
      if (returnToPractice && updated) {
        const numberedPinyin = toNumberedPinyin(updated.pinyin);
        const englishPrompt = updated.english.join(', ');
        for (const q of [...questions, ...allQuestions, ...incorrectThisRound]) {
          if (q.word.hanzi !== hanzi) {
            continue;
          }
          q.word.pinyin = updated.pinyin;
          q.word.english = updated.english;
          q.word.polish = updated.polish;
          q.word.categories = updated.categories;
          q.word.aiCategories = updated.aiCategories;
          q.word.aiEnglish = updated.aiEnglish;
          q.word.aiNotes = updated.aiNotes;
          if (currentMode === 'english2hanzi' || currentMode === 'english2pinyin') {
            q.prompt = englishPrompt;
          }
          if (currentMode === 'hanzi2pinyin' || currentMode === 'english2pinyin') {
            q.acceptedAnswers = [numberedPinyin];
          }
        }
      }
    } else {
      const added = await addWord(
        hanzi,
        pinyin,
        englishValues,
        polishValues,
        categoryValues,
        queueAsNewCb.checked,
        aiCategoryValues,
        aiEnglishValues,
        aiNotesInput.value.trim()
      );
      if (added.warnings && added.warnings.length > 0) {
        showAddWordStatus(`Added "${hanzi}", but: ${added.warnings.join('; ')}`, 'error');
      } else {
        showAddWordStatus(`Added "${hanzi}" successfully!`, 'success');
      }
    }

    // Reset form
    addHanziInput.value = '';
    addPinyinInput.value = '';
    addCategoriesInput.value = '';
    englishList.clear();
    polishList.clear();
    categoryValues = [];
    editingExistingWord = false;
    renderChips(categoryChips, categoryValues, removeCategoryChip);
    setAiCategories([]);
    setAiEnglish([]);
    setAiNotes('');
    clearInferMarks();
    cedictEntries.classList.add('hidden');
    wordInfoDiv.classList.add('hidden');
    wordBreakdown.classList.add('hidden');
    setEditOnlyUiVisible(false);

    // Reload stats and categories
    loadStats();

    // Return to origin screen if editing from practice or search
    if (returnToSearch) {
      returnToSearch = false;
      showView('search');
    } else if (returnToPractice) {
      returnToPractice = false;
      showView('practice');
    }
  } catch (error) {
    showAddWordStatus(error instanceof Error ? error.message : 'Failed to save word', 'error');
  } finally {
    addWordBtn.disabled = false;
    addWordBtn.textContent = editingExistingWord ? 'Save' : 'Add';
  }
});

/** Category tags for a word — the user's own first, then the AI-inferred ones, badged */
function categoryTagsHtml(word: Word): string {
  const tags = word.categories.map((c) => `<span class="answer-category">${c}</span>`);
  for (const cat of word.aiCategories ?? []) {
    tags.push(
      `<span class="answer-category ai-category" title="Inferred by AI"><span class="ai-mark" aria-hidden="true">✨</span>${cat}</span>`
    );
  }
  return tags.join(' ');
}

/** AI-inferred English glosses, shown under the curated ones */
function aiEnglishHtml(word: Word): string {
  if (!word.aiEnglish || word.aiEnglish.length === 0) {
    return '';
  }
  return `<div class="answer-ai-english"><span class="ai-mark" aria-hidden="true">✨</span>${formatTranslations(word.aiEnglish)}</div>`;
}

/** The AI's usage note for a word, badged so its origin is obvious */
function aiNotesHtml(word: Word): string {
  if (!word.aiNotes) {
    return '';
  }
  return `<div class="ai-note"><span class="ai-mark" aria-hidden="true">✨</span><span class="ai-note-text">${word.aiNotes}</span></div>`;
}

function hasCategoryTags(word: Word): boolean {
  return word.categories.length > 0 || (word.aiCategories ?? []).length > 0;
}

function showAddWordStatus(message: string, type: 'success' | 'error') {
  addWordStatus.textContent = message;
  addWordStatus.className = `add-word-status ${type}`;
  addWordStatus.classList.remove('hidden');
  setTimeout(() => addWordStatus.classList.add('hidden'), 5000);
}

// Search screen
const MODE_SHORT: Record<string, string> = {
  hanzi2pinyin: 'hanzi→pinyin',
  english2pinyin: 'english→pinyin',
  english2hanzi: 'english→hanzi',
};

function formatDue(nextEligible: string | null): string {
  if (nextEligible === null) {
    return '—';
  }
  const diff = new Date(nextEligible).getTime() - Date.now();
  if (diff <= 0) {
    return 'now';
  }
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) {
    return `${mins}m`;
  }
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(diff / 86_400_000);
  return `${days}d`;
}

function formatWordDetail(word: Word, progress: Progress[]): string {
  const polishHtml = formatPolish(word.polish);
  let html = `<div class="search-detail-top">
    ${clickableHanzi(word.hanzi, 'answer-hanzi')}
    <span class="answer-pinyin">${word.pinyin}</span>
    <span class="answer-english">${formatTranslations(word.english)}</span>
    ${polishHtml ? `<span class="answer-polish">${polishHtml}</span>` : ''}
  </div>`;

  if (hasCategoryTags(word)) {
    html += `<div class="answer-categories">${categoryTagsHtml(word)}</div>`;
  }

  html += aiEnglishHtml(word);

  const progressByMode = new Map(progress.map((p) => [p.mode, p]));
  const progressParts = (['hanzi2pinyin', 'english2pinyin', 'english2hanzi'] as const).map((mode) => {
    const p = progressByMode.get(mode);
    const label = MODE_SHORT[mode];
    if (!p || p.bucket === null) {
      return `<span class="search-progress-item search-progress-none">${label}: —</span>`;
    }
    return `<span class="search-progress-item">${label}: bucket ${p.bucket} <span class="search-due-time">${formatDue(p.nextEligible)}</span></span>`;
  });
  html += `<div class="search-progress">${progressParts.join('')}</div>`;

  if (word.examples.length > 0) {
    html += `<div class="example-sentence">${formatExampleAnswers(word.examples)}</div>`;
  }

  if (word.breakdown && word.breakdown.length > 0) {
    html += formatBreakdown(word.breakdown);
  }

  html += aiNotesHtml(word);

  html += `<div class="search-detail-actions">
    <button class="search-edit-btn edit-word-btn">Edit word</button>
  </div>`;

  return html;
}

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let expandedSearchEl: HTMLElement | null = null;
let originalResultOrder: HTMLElement[] = [];
let hanziMode: MatchMode = 'contains';
let pinyinMode: MatchMode = 'contains';

function insertRelatedDuplicates(anchor: HTMLElement) {
  removeRelatedDuplicates();
  const hanzi = anchor.dataset.hanzi!;
  let insertAfter = anchor;
  for (const el of originalResultOrder) {
    if (el === anchor) {
      continue;
    }
    if (el.dataset.hanzi!.includes(hanzi)) {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.classList.add('search-result-duplicate');
      clone.querySelector('.search-detail')?.classList.add('hidden');
      insertAfter.after(clone);
      insertAfter = clone;
    }
  }
}

function removeRelatedDuplicates() {
  searchResultsDiv.querySelectorAll('.search-result-duplicate').forEach((el) => el.remove());
}

function initModeGroup(group: HTMLElement, getCurrent: () => MatchMode, setCurrent: (m: MatchMode) => void) {
  group.querySelectorAll<HTMLButtonElement>('.match-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode as MatchMode;
      setCurrent(mode);
      group.querySelectorAll('.match-mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      triggerSearch();
    });
  });
}

initModeGroup(hanziModeGroup, () => hanziMode, (m) => { hanziMode = m; });
initModeGroup(pinyinModeGroup, () => pinyinMode, (m) => { pinyinMode = m; });

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightHanzi(text: string, query: string, mode: MatchMode): string {
  if (!query) {
    return escapeHtml(text);
  }
  let idx: number;
  switch (mode) {
    case 'prefix':
      idx = text.startsWith(query) ? 0 : -1;
      break;
    case 'suffix':
      idx = text.endsWith(query) ? text.length - query.length : -1;
      break;
    case 'exact':
      idx = text === query ? 0 : -1;
      break;
    default:
      idx = text.indexOf(query);
  }
  if (idx === -1) {
    return escapeHtml(text);
  }
  return (
    escapeHtml(text.slice(0, idx)) +
    `<mark class="search-match">${escapeHtml(text.slice(idx, idx + query.length))}</mark>` +
    escapeHtml(text.slice(idx + query.length))
  );
}

function highlightPinyin(pinyin: string, pinyinQuery: string, mode: MatchMode): string {
  if (!pinyinQuery) {
    return escapeHtml(pinyin);
  }
  const tokens = splitPinyinQuery(pinyinQuery.trim()).filter((t) => t.base.length > 0);
  if (tokens.length === 0) {
    return escapeHtml(pinyin);
  }
  const syllables = pinyin.split(' ');
  const candidates = pinyinCandidateIndices(syllables.length, tokens.length, mode);

  let matchStart = -1;
  for (const i of candidates) {
    if (i >= 0 && tokens.every((tok, j) => syllableMatchesToken(syllables[i + j], tok))) {
      matchStart = i;
      break;
    }
  }
  if (matchStart === -1) {
    return escapeHtml(pinyin);
  }
  const matchEnd = matchStart + tokens.length;
  const before = syllables.slice(0, matchStart).map(escapeHtml).join(' ');
  const matched = syllables.slice(matchStart, matchEnd).map(escapeHtml).join(' ');
  const after = syllables.slice(matchEnd).map(escapeHtml).join(' ');
  const parts = [];
  if (before) {
    parts.push(before);
  }
  parts.push(`<mark class="search-match">${matched}</mark>`);
  if (after) {
    parts.push(after);
  }
  return parts.join(' ');
}

function highlightEnglish(english: string[], englishQuery: string): string {
  const sep = '<span class="english-sep"> • </span>';
  if (!englishQuery) {
    return english.map(escapeHtml).join(sep);
  }
  const q = englishQuery.toLowerCase();
  const qEscaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${qEscaped}`, 'gi');
  return english.map((def) => {
    let result = '';
    let lastIndex = 0;
    for (const m of def.matchAll(re)) {
      result += escapeHtml(def.slice(lastIndex, m.index));
      result += `<mark class="search-match">${escapeHtml(def.slice(m.index, m.index + q.length))}</mark>`;
      lastIndex = m.index + q.length;
    }
    result += escapeHtml(def.slice(lastIndex));
    return result;
  }).join(sep);
}

function renderSearchResults(
  results: SearchResult[],
  hanziQ: string,
  pinyinQ: string,
  englishQ: string
) {
  if (results.length === 0) {
    searchResultsDiv.innerHTML = '<p class="search-empty">No results.</p>';
    return;
  }
  const header = `<div class="search-results-header">
    <span class="search-col-focus"></span>
    <span class="search-col-hanzi">Hanzi</span>
    <span class="search-col-pinyin">Pinyin</span>
    <span class="search-col-english">English</span>
    <span class="search-rank-col">Word</span>
    <span class="search-rank-col">Char</span>
  </div>`;

  searchResultsDiv.innerHTML = header + results
    .map((r) => {
      const hanziHtml = highlightHanzi(r.word.hanzi, hanziQ, hanziMode);
      const pinyinHtml = highlightPinyin(r.word.pinyin, pinyinQ, pinyinMode);
      const englishHtml = highlightEnglish(r.word.english, englishQ);
      const polishInline = r.word.polish && r.word.polish.length > 0
        ? `<div class="search-polish">${r.word.polish.map((p) => escapeHtml(p)).join('; ')}</div>`
        : '';
      const wordRank = r.word.wordFrequencyRank != null ? `#${r.word.wordFrequencyRank}` : '—';
      const charRank = r.word.hanziFrequencyRank != null ? `#${r.word.hanziFrequencyRank}` : '—';
      const queuedClass = r.queued ? ' search-result-queued' : '';
      const queuedTitle = r.queued ? ' title="Queued for practice, not yet learned"' : '';
      return `<div class="search-result${queuedClass}" data-hanzi="${escapeHtml(r.word.hanzi)}"${queuedTitle}>
      <div class="search-result-summary">
        <span class="search-col-focus"><button class="search-focus-btn" data-hanzi="${escapeHtml(r.word.hanzi)}"></button></span>
        <span class="search-hanzi">${hanziHtml}</span>
        <span class="preview-pinyin">${pinyinHtml}</span>
        <span class="preview-english">${englishHtml}${polishInline}</span>
        <span class="search-rank-col" title="Word frequency rank">${wordRank}</span>
        <span class="search-rank-col" title="Character frequency rank">${charRank}</span>
      </div>
      <div class="search-detail hidden">${formatWordDetail(r.word, r.progress)}</div>
    </div>`;
    })
    .join('');

  originalResultOrder = Array.from(searchResultsDiv.querySelectorAll<HTMLElement>('.search-result'));

  searchResultsDiv.querySelectorAll<HTMLElement>('.search-result').forEach((el) => {
    el.querySelector('.search-result-summary')!.addEventListener('click', () => {
      const detail = el.querySelector('.search-detail') as HTMLElement;
      if (expandedSearchEl === el) {
        detail.classList.add('hidden');
        el.classList.remove('search-result-expanded');
        removeRelatedDuplicates();
        expandedSearchEl = null;
      } else {
        if (expandedSearchEl) {
          expandedSearchEl.querySelector('.search-detail')?.classList.add('hidden');
          expandedSearchEl.classList.remove('search-result-expanded');
        }
        detail.classList.remove('hidden');
        el.classList.add('search-result-expanded');
        insertRelatedDuplicates(el);
        expandedSearchEl = el;
      }
    });


    el.querySelector('.search-focus-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const hanzi = (e.currentTarget as HTMLElement).dataset.hanzi!;
      searchHanziInput.value = hanzi;
      searchPinyinInput.value = '';
      searchEnglishInput.value = '';
      triggerSearch(true);
    });

    el.querySelector('.search-edit-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const hanzi = (el as HTMLElement).dataset.hanzi!;
      const result = results.find((r) => r.word.hanzi === hanzi);
      if (result) {
        editWordFromSearch(result.word);
      }
    });
  });
}

async function executeSearch() {
  const hanziQ = searchHanziInput.value.trim();
  const pinyinQ = searchPinyinInput.value.trim();
  const englishQ = searchEnglishInput.value.trim();
  updateSearchUrl();
  if (!hanziQ && !pinyinQ && !englishQ) {
    searchResultsDiv.innerHTML = '';
    expandedSearchEl = null;
    return;
  }
  try {
    const results = await searchWords(hanziQ, hanziMode, pinyinQ, pinyinMode, englishQ);
    expandedSearchEl = null;
    renderSearchResults(results, hanziQ, pinyinQ, englishQ);
  } catch (error) {
    console.error('Search failed:', error);
  }
}

function triggerSearch(immediate = false) {
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer);
  }
  if (immediate) {
    executeSearch();
    return;
  }
  searchDebounceTimer = setTimeout(() => {
    executeSearch();
  }, 300);
}

for (const input of [searchHanziInput, searchPinyinInput, searchEnglishInput]) {
  input.addEventListener('input', () => {
    for (const other of [searchHanziInput, searchPinyinInput, searchEnglishInput]) {
      if (other !== input) {
        other.value = '';
      }
    }
    triggerSearch();
  });
}

// Initialize
if (!restoreSession()) {
  const initialView = viewFromPath();
  if (initialView === 'practice') {
    showScreen(startScreen);
  } else {
    showView(initialView, false);
  }
}
loadStats();
setInterval(() => {
  if (startScreen.classList.contains('active')) {
    reloadStats();
  }
}, 10_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && startScreen.classList.contains('active')) {
    reloadStats();
  }
});
