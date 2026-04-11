import type {
  CharacterInfo,
  PracticeMode,
  PracticeQuestion,
  WordProgress,
  CedictEntry,
  Word,
} from './services.js';
import type { Example, Stats } from '../shared/types.js';
import { toNumberedPinyin, validatePinyin } from '../shared/pinyin.js';
import {
  addHanziSynonym,
  addWord,
  assessSpeech,
  clearWordQueued,
  completePractice,
  getCategories,
  getStats,
  getWordCount,
  lookupHanzi,
  previewNewWords,
  resetWordBucket,
  resetWordProgress,
  startPractice,
  submitAnswer,
  updateWord,
} from './services.js';

// DOM Elements
const startScreen = document.getElementById('start-screen')!;
const practiceScreen = document.getElementById('practice-screen')!;
const resultScreen = document.getElementById('result-screen')!;
const addWordScreen = document.getElementById('add-word-screen')!;

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
const resetProgressBtn = document.getElementById('reset-progress-btn') as HTMLButtonElement;
const resultStatsDiv = document.getElementById('result-stats')!;
const mistakesSection = document.getElementById('mistakes-section')!;
const mistakesList = document.getElementById('mistakes-list')!;
const restartBtn = document.getElementById('restart-btn')!;
const categoryList = document.getElementById('category-list')!;
const categorySelected = document.getElementById('category-selected')!;
const categorySearch = document.getElementById('category-search') as HTMLInputElement;
const autoplayCheckbox = document.getElementById('autoplay-audio') as HTMLInputElement;

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
let currentView: 'practice' | 'add-word' = 'practice';
let lastPracticeScreen: HTMLElement = startScreen;

function showView(view: 'practice' | 'add-word') {
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

  if (view === 'practice') {
    lastPracticeScreen.classList.add('active');
  } else if (view === 'add-word') {
    addWordScreen.classList.add('active');
    ensureCurated();
    renderChips(categoryChips, categoryValues, removeCategoryChip);
  }
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const view = (item as HTMLElement).dataset.view as 'practice' | 'add-word';
    if (view === 'practice') {
      returnToPractice = false;
      cancelEditBtn.classList.add('hidden');
    }
    showView(view);
  });
});

// Load preferences from localStorage
autoplayCheckbox.checked = localStorage.getItem('autoplayAudio') !== 'false';
autoplayCheckbox.addEventListener('change', () => {
  localStorage.setItem('autoplayAudio', String(autoplayCheckbox.checked));
});
categorySearch.addEventListener('input', filterCategoryList);
const savedCharMode: Record<string, boolean> = JSON.parse(localStorage.getItem('charModes') ?? '{}');
function getCharMode(mode: PracticeMode): boolean {
  return savedCharMode[mode] ?? false;
}
function setCharMode(mode: PracticeMode, on: boolean) {
  savedCharMode[mode] = on;
  localStorage.setItem('charModes', JSON.stringify(savedCharMode));
}
const ALL_MODES: PracticeMode[] = ['hanzi2pinyin', 'english2pinyin', 'english2hanzi'];
function getCharModesList(): PracticeMode[] {
  return ALL_MODES.filter((m) => getCharMode(m));
}

const savedWordCounts: Record<string, number> = JSON.parse(localStorage.getItem('wordCounts') ?? '{}');
function getModeWordCount(mode: PracticeMode): number {
  return savedWordCounts[mode] ?? 10;
}
function setModeWordCount(mode: PracticeMode, count: number) {
  savedWordCounts[mode] = count;
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

function toggleCategory(cat: string, checked: boolean) {
  if (checked) {
    selectedCategories.add(cat);
  } else {
    selectedCategories.delete(cat);
  }
  localStorage.setItem('selectedCategories', JSON.stringify([...selectedCategories]));
  sortCategoryList();
  reloadStats();
}

function filterCategoryList() {
  const query = categorySearch.value.toLowerCase();
  for (const item of Array.from(categoryList.children) as HTMLElement[]) {
    const value = (item.querySelector('input') as HTMLInputElement).value.toLowerCase();
    item.classList.toggle('hidden', query !== '' && !value.includes(query));
  }
}

function sortCategoryList() {
  const items = [
    ...Array.from(categorySelected.children),
    ...Array.from(categoryList.children),
  ] as HTMLElement[];
  const checked = items.filter((el) => (el.querySelector('input') as HTMLInputElement).checked);
  const unchecked = items.filter((el) => !(el.querySelector('input') as HTMLInputElement).checked);
  unchecked.sort((a, b) =>
    (a.querySelector('input') as HTMLInputElement).value.localeCompare(
      (b.querySelector('input') as HTMLInputElement).value,
    ),
  );
  for (const item of checked) {
    categorySelected.appendChild(item);
  }
  for (const item of unchecked) {
    categoryList.appendChild(item);
  }
  filterCategoryList();
}

// Load stats on start
async function loadStats() {
  try {
    const [stats, totalWords, categories] = await Promise.all([
      getStats(getSelectedCategories(), getCharModesList()),
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
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = cat;
      checkbox.checked = selectedCategories.has(cat);
      checkbox.addEventListener('change', () => toggleCategory(cat, checkbox.checked));
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(cat));
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

function renderStats(stats: Stats[]) {
  stats = [...stats].sort((a, b) => ALL_MODES.indexOf(a.mode) - ALL_MODES.indexOf(b.mode));
  const html = stats
    .map((s) => {
      const BUCKET_LABELS = ['now', '5m', '30m', '4h', '1d', '3d', '7d', '14d', '30d'];
      const bucketTimings = s.buckets
        .map((_, i) => `<span class="bucket-timing">${BUCKET_LABELS[i] ?? ''}</span>`)
        .join('');
      const bucketBar = s.buckets
        .map((count, i) => {
          const due = s.dueBuckets[i] || 0;
          const dueLabel = due > 0 ? `<span class="bucket-due">${due}</span> ` : '';
          return `<span class="bucket-count" title="Bucket ${i}: ${count} total, ${due} due">${dueLabel}${count}</span>`;
        })
        .join('');
      const dueBtn = `<button class="due-mode-btn" data-mode="${s.mode}" data-count="${s.dueForReview}" ${s.dueForReview === 0 ? 'disabled' : ''}>${s.dueForReview} due</button>`;
      const previewBtn = `<button class="mode-preview-btn" data-mode="${s.mode}">Preview queued</button>`;
      const presets = [5, 10, 20, 30, 50];
      const modeCount = getModeWordCount(s.mode);
      const isCustom = !presets.includes(modeCount);
      const countPresets = presets
        .map((n) => `<button class="count-preset${n === modeCount ? ' active' : ''}" data-mode="${s.mode}" data-count="${n}">${n}</button>`)
        .join('') +
        `<input type="number" class="count-input${isCustom ? ' active' : ''}" data-mode="${s.mode}" value="${modeCount}" min="1" max="999">`;
      return `
      <div class="mode-card" data-mode="${s.mode}">
        <div class="mode-card-header">
          <strong>${MODE_LABELS[s.mode] ?? s.mode}</strong>
          <span class="mode-card-stats">${s.learned}/${s.totalWords} learned, ${s.mastered} mastered</span>
        </div>
        <div class="bucket-timings">${bucketTimings}</div>
        <div class="bucket-bar">${bucketBar}</div>
        <div class="mode-card-options">
          <div class="mode-card-count">${countPresets}</div>
          <label class="mode-char-mode"><input type="checkbox" class="char-mode-cb" data-mode="${s.mode}" ${getCharMode(s.mode) ? 'checked' : ''}> Char mode</label>
        </div>
        <div class="mode-card-actions">
          ${dueBtn}<button class="mode-review-btn" data-mode="${s.mode}">Review</button>
          <button class="mode-random-btn" data-mode="${s.mode}">Random</button>
          ${previewBtn}
        </div>
        <div class="preview-section hidden" data-mode="${s.mode}"></div>
      </div>
    `;
    })
    .join('');

  statsDiv.innerHTML = html;
  latestStats = stats;

  // Review-only buttons
  statsDiv.querySelectorAll('.mode-review-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      currentMode = mode;
      localStorage.setItem('mode', mode);
      handleStart(undefined, 'review');
    });
  });

  // Random review buttons
  statsDiv.querySelectorAll('.mode-random-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      currentMode = mode;
      localStorage.setItem('mode', mode);
      handleStart(undefined, 'random');
    });
  });

  // Due buttons
  statsDiv.querySelectorAll('.due-mode-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      const count = parseInt((btn as HTMLElement).dataset.count!);
      currentMode = mode;
      localStorage.setItem('mode', mode);

      try {
        const response = await startPractice(
          count, mode, 'review', getSelectedCategories(), getCharMode(mode)
        );
        characterMode = getCharMode(mode);
        questions = shuffle(response.questions);
        allQuestions = [...questions];
        currentIndex = 0;
        results.clear();
        incorrectThisRound = [];
        roundNumber = 1;
        newWords.clear();

        showScreen(practiceScreen);
        showQuestion();
        saveSession();
      } catch (error) {
        alert(error instanceof Error ? error.message : 'Failed to start practice');
      }
    });
  });

  // Preview buttons (toggle)
  statsDiv.querySelectorAll('.mode-preview-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      const section = statsDiv.querySelector(`.preview-section[data-mode="${mode}"]`) as HTMLElement;
      if (previewMode === mode) {
        // Toggle off
        section.classList.add('hidden');
        section.innerHTML = '';
        previewMode = null;
        previewSelected.clear();
        return;
      }
      // Close any other open preview
      if (previewMode) {
        const prev = statsDiv.querySelector(`.preview-section[data-mode="${previewMode}"]`) as HTMLElement;
        prev.classList.add('hidden');
        prev.innerHTML = '';
      }
      currentMode = mode;
      localStorage.setItem('mode', mode);
      previewSelected.clear();
      previewMode = mode;
      loadPreviewPage(0, btn as HTMLButtonElement);
    });
  });

  // Count preset buttons and input (per-mode)
  function updateModeCount(mode: PracticeMode, count: number) {
    setModeWordCount(mode, count);
    const presets = [5, 10, 20, 30, 50];
    const card = statsDiv.querySelector(`.mode-card[data-mode="${mode}"]`)!;
    card.querySelectorAll('.count-preset').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.count === String(count));
    });
    const input = card.querySelector('.count-input') as HTMLInputElement;
    input.value = String(count);
    input.classList.toggle('active', !presets.includes(count));
  }

  statsDiv.querySelectorAll('.count-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as PracticeMode;
      updateModeCount(mode, parseInt((btn as HTMLElement).dataset.count!));
    });
  });

  statsDiv.querySelectorAll('.count-input').forEach((input) => {
    input.addEventListener('focus', () => {
      (input as HTMLInputElement).select();
    });
    input.addEventListener('change', () => {
      const mode = (input as HTMLElement).dataset.mode as PracticeMode;
      updateModeCount(mode, parseInt((input as HTMLInputElement).value) || 10);
    });
  });

  // Character mode checkboxes
  statsDiv.querySelectorAll('.char-mode-cb').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const input = cb as HTMLInputElement;
      const mode = input.dataset.mode as PracticeMode;
      setCharMode(mode, input.checked);
      const card = statsDiv.querySelector(`.mode-card[data-mode="${mode}"]`) as HTMLElement;
      const timer = setTimeout(() => card.classList.add('loading'), 100);
      try {
        const stats = await getStats(getSelectedCategories(), getCharModesList());
        clearTimeout(timer);
        renderStats(stats);
      } catch (error) {
        clearTimeout(timer);
        console.error('Failed to reload stats:', error);
        card.classList.remove('loading');
      }
    });
  });
}

async function reloadStats() {
  const timer = setTimeout(() => statsDiv.classList.add('loading'), 100);
  try {
    const stats = await getStats(getSelectedCategories(), getCharModesList());
    clearTimeout(timer);
    renderStats(stats);
  } catch (error) {
    clearTimeout(timer);
    console.error('Failed to reload stats:', error);
  } finally {
    statsDiv.classList.remove('loading');
  }
}

function getSelectedCategories(): string[] {
  return Array.from(selectedCategories);
}

// Start practice
async function handleStart(hanziList?: string[], wordSelection: string = 'review') {
  const count = getModeWordCount(currentMode);

  try {
    const selectedCategories = getSelectedCategories();
    const response = await startPractice(
      count,
      currentMode,
      wordSelection,
      selectedCategories,
      getCharMode(currentMode),
      hanziList
    );
    characterMode = getCharMode(currentMode);
    questions = shuffle(response.questions);
    allQuestions = [...questions];
    currentIndex = 0;
    results.clear();
    incorrectThisRound = [];
    roundNumber = 1;
    newWords.clear();

    closePreview();

    showScreen(practiceScreen);
    showQuestion();
    saveSession();
  } catch (error) {
    alert(error instanceof Error ? error.message : 'Failed to start practice');
  }
}

// Audio playback
function playAudio(hanzi: string, auto: boolean = false) {
  if (auto && !autoplayCheckbox.checked) return;
  const audio = new Audio(`/audio/${encodeURIComponent(hanzi)}.mp3`);
  audio.play().catch((err) => console.warn('Audio playback failed:', err));
}


// Make hanzi clickable for audio
function clickableHanzi(hanzi: string, className: string): string {
  return `<span class="${className} clickable-hanzi" data-hanzi="${hanzi}">${hanzi}</span>`;
}

// Format example hints for question (varies by mode)
function formatExampleHints(examples: Example[]): string {
  if (currentMode === 'english2hanzi' || currentMode === 'english2pinyin') {
    // english->X: show english only (to not give away the answer)
    return examples.map((ex) => `<span class="ex-english">${ex.english}</span>`).join('<br>');
  } else {
    // hanzi->X modes: show clickable example hanzi
    return examples.map((ex) => clickableHanzi(ex.hanzi, 'ex-hanzi')).join('<br>');
  }
}

// Format full examples for answer
function formatExampleAnswers(examples: Example[]): string {
  return examples
    .map(
      (ex) =>
        `${clickableHanzi(ex.hanzi, 'ex-hanzi')} <span class="ex-pinyin">(${ex.pinyin})</span> <span class="ex-english">— ${ex.english}</span>`
    )
    .join('<br>');
}

// Show current question
function showQuestion() {
  const question = questions[currentIndex];
  const word = question.word;
  const bucketLabel = question.bucket === null ? 'new' : `B${question.bucket}`;

  const ranks =
    [
      word.wordFrequencyRank != null ? `word #${word.wordFrequencyRank}` : null,
      word.hanziFrequencyRank != null ? `char #${word.hanziFrequencyRank}` : null,
    ]
      .filter(Boolean)
      .join(', ') || '?';
  progressText.textContent = `Question ${currentIndex + 1} of ${questions.length} (${bucketLabel}, ${ranks})`;

  // Show example hints alongside the question
  if (currentMode === 'english2hanzi' || currentMode === 'english2pinyin') {
    // english->X mode: show english prompt, no clickable hanzi
    if (word.examples.length > 0) {
      promptDiv.innerHTML = `${question.prompt}<div class="example-hint">${formatExampleHints(word.examples)}</div>`;
    } else {
      promptDiv.textContent = question.prompt;
    }
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
    playAudio(question.word.hanzi, true);
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
      const hanziSpan = node.traditional
        ? `<span class="${hanziClass} tree-has-traditional">${node.hanzi}<span class="tree-traditional">${node.traditional}</span></span>`
        : `<span class="${hanziClass}">${node.hanzi}</span>`;
      const label = `${hanziSpan} <span class="tree-pinyin">${node.pinyin}</span> <span class="tree-meaning">${node.meaning}</span>`;
      if (node.components.length > 0) {
        return `<li class="tree-node"><details><summary>${label}</summary><ul class="tree-children">${formatTreeNodes(node.components, false)}</ul></details></li>`;
      }
      return `<li class="tree-node tree-leaf">${label}</li>`;
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
  const english = `<span class="answer-english">${word.english.join('; ')}</span>`;

  // All modes show: hanzi (pinyin) - english
  let result = `${hanzi} (${pinyin}) — ${english}`;

  // Show categories
  if (word.categories.length > 0) {
    const cats = word.categories.map((c) => `<span class="answer-category">${c}</span>`).join(' ');
    result += `<div class="answer-categories">${cats}</div>`;
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
    const originalFeedbackHtml = feedbackDiv.innerHTML;
    document.getElementById('synonym-btn')!.addEventListener('click', () => {
      feedbackDiv.innerHTML = `<div class="synonym-input-row"><input type="text" id="synonym-hanzi-input" placeholder="Synonym hanzi" class="synonym-hanzi-input"><button id="synonym-confirm-btn" class="primary-btn">Confirm</button><button id="synonym-cancel-btn" class="secondary-btn">Cancel</button></div>`;
      const synonymInput = document.getElementById('synonym-hanzi-input') as HTMLInputElement;
      synonymInput.focus();

      document.getElementById('synonym-confirm-btn')!.addEventListener('click', async () => {
        const synonymHanzi = synonymInput.value.trim();
        if (!synonymHanzi) return;
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
      });

      synonymInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          document.getElementById('synonym-confirm-btn')!.click();
        }
      });

      document.getElementById('synonym-cancel-btn')!.addEventListener('click', () => {
        feedbackDiv.innerHTML = originalFeedbackHtml;
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

  playAudio(question.word.hanzi, true);
  submitBtn.classList.add('hidden');
  skipBtn.classList.add('hidden');
  practiceActions.classList.remove('hidden');
  answerInput.disabled = true;
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
          <span class="details">(${q.word.pinyin}) - ${q.word.english[0]}</span>
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
  englishValues = [...word.english];
  renderEnglishList();
  categoryValues = [...word.categories];
  ensureCurated();
  renderChips(categoryChips, categoryValues, removeCategoryChip);
  editingExistingWord = true;
  queueAsNewCb.checked = question.bucket === null;
  addWordBtn.textContent = 'Save';
  addWordStatus.classList.add('hidden');
  performHanziLookup(word.hanzi);

  returnToPractice = true;
  cancelEditBtn.classList.remove('hidden');
  resetProgressBtn.classList.remove('hidden');
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
  returnToPractice = false;
  cancelEditBtn.classList.add('hidden');
  resetProgressBtn.classList.add('hidden');
  showView('practice');
});

resetProgressBtn.addEventListener('click', async () => {
  const hanzi = addHanziInput.value.trim();
  if (!hanzi) return;

  try {
    await resetWordProgress(hanzi);
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
      cancelEditBtn.classList.add('hidden');
      resetProgressBtn.classList.add('hidden');

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
    } else if (!practiceActions.classList.contains('hidden')) {
      handleNext();
    }
  }
});


// Preview new words
const PREVIEW_PAGE_SIZE = 50;
let previewSelected = new Set<string>();
let previewOffset = 0;
let previewTotal = 0;
let previewMode: PracticeMode | null = null;

function updatePracticeSelectedBtn() {
  const section = getPreviewSection();
  if (!section) return;
  const btn = section.querySelector('.practice-selected-btn') as HTMLButtonElement | null;
  if (!btn) return;
  const count = previewSelected.size;
  btn.disabled = count === 0;
  btn.textContent = count === 0 ? 'Practice selected' : `Practice ${count} selected`;
}

function getPreviewSection(): HTMLElement | null {
  if (!previewMode) return null;
  return statsDiv.querySelector(`.preview-section[data-mode="${previewMode}"]`);
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
    const { words, total } = await previewNewWords(
      currentMode,
      getSelectedCategories(),
      getCharMode(currentMode),
      PREVIEW_PAGE_SIZE,
      offset
    );
    previewTotal = total;

    if (total === 0) {
      section.innerHTML = '<p class="preview-empty">No new words available.</p>';
      section.classList.remove('hidden');
      return;
    }

    const pageStart = offset + 1;
    const pageEnd = offset + words.length;
    const hasPrev = offset > 0;
    const hasNext = offset + words.length < total;

    const paginationHtml = `<div class="preview-pagination">` +
      `<button class="preview-prev secondary-btn" ${hasPrev ? '' : 'disabled'}>Prev</button>` +
      `<span class="preview-page-info">${pageStart}–${pageEnd} of ${total}</span>` +
      `<button class="preview-next secondary-btn" ${hasNext ? '' : 'disabled'}>Next</button>` +
      `</div>`;

    section.innerHTML =
      `<div class="preview-header"><label class="preview-select-all"><input type="checkbox" class="preview-select-all-cb"> Select all</label><button class="practice-selected-btn primary-btn" disabled>Practice selected</button></div>` +
      words
        .map((w) => {
          const ranks = [
            w.wordFrequencyRank != null ? `word #${w.wordFrequencyRank}` : null,
            w.hanziFrequencyRank != null ? `char #${w.hanziFrequencyRank}` : null,
          ]
            .filter(Boolean)
            .join(', ');
          const rankSpan = ranks ? ` <span class="preview-rank">${ranks}</span>` : '';
          const cats =
            w.categories.length > 0
              ? ` <span class="preview-categories">${w.categories.map((c) => `<span class="answer-category">${c}</span>`).join(' ')}</span>`
              : '';
          const hasResetPriority = getCharMode(currentMode) ? !!w.charQueuedAt : !!w.queuedAt;
          const resetTag = hasResetPriority
            ? ` <span class="preview-queued">queued</span><button class="preview-dismiss-btn" data-hanzi="${w.hanzi}">✕</button>`
            : '';
          const checked = previewSelected.has(w.hanzi) ? 'checked' : '';
          return `<label class="preview-word"><input type="checkbox" class="preview-checkbox" data-hanzi="${w.hanzi}" ${checked}> ${clickableHanzi(w.hanzi, 'preview-hanzi')} <span class="preview-pinyin">${w.pinyin}</span> <span class="preview-english">${w.english.join('; ')}</span>${rankSpan}${cats}${resetTag}</label>`;
        })
        .join('') +
      paginationHtml;

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
    selectAllCb.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      section.querySelectorAll('.preview-checkbox').forEach((cb) => {
        const input = cb as HTMLInputElement;
        input.checked = checked;
        if (checked) {
          previewSelected.add(input.dataset.hanzi!);
        } else {
          previewSelected.delete(input.dataset.hanzi!);
        }
      });
      updatePracticeSelectedBtn();
    });

    // Practice selected handler
    section.querySelector('.practice-selected-btn')!.addEventListener('click', () => {
      handleStart([...previewSelected]);
    });

    // Dismiss (clear reset priority) handlers
    section.querySelectorAll('.preview-dismiss-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const hanzi = (btn as HTMLButtonElement).dataset.hanzi!;
        await clearWordQueued(hanzi, getCharMode(currentMode));
        loadPreviewPage(previewOffset);
      });
    });

    // Pagination handlers
    section.querySelector('.preview-prev')!.addEventListener('click', () => {
      loadPreviewPage(Math.max(0, previewOffset - PREVIEW_PAGE_SIZE));
    });
    section.querySelector('.preview-next')!.addEventListener('click', () => {
      loadPreviewPage(previewOffset + PREVIEW_PAGE_SIZE);
    });

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


// Add word form
const addWordForm = document.getElementById('add-word-screen')!;
const addHanziInput = document.getElementById('add-hanzi') as HTMLInputElement;
const addPinyinInput = document.getElementById('add-pinyin') as HTMLInputElement;
const addEnglishInput = document.getElementById('add-english') as HTMLInputElement;
const addCategoriesInput = document.getElementById('add-categories') as HTMLInputElement;
const englishList = document.getElementById('english-list')!;
const categoryChips = document.getElementById('category-chips')!;
const cedictEntries = document.getElementById('cedict-entries')!;
const wordInfoDiv = document.getElementById('word-info')!;
const wordBreakdown = document.getElementById('word-breakdown')!;
const categorySuggestions = document.getElementById('category-suggestions')!;
const addWordBtn = document.getElementById('add-word-btn') as HTMLButtonElement;
const addWordStatus = document.getElementById('add-word-status')!;
const queueAsNewCb = document.getElementById('queue-as-new-cb') as HTMLInputElement;
const queueAsNewLabel = document.getElementById('queue-as-new-label')!;

let englishValues: string[] = [];
let categoryValues: string[] = [];
let allCategoriesList: string[] = [];
let lookupTimer: ReturnType<typeof setTimeout> | null = null;
let editingExistingWord = false;
let returnToPractice = false;

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

let englishDragSrcIndex: number | null = null;
let englishInsertIndex: number | null = null;
let englishStride = 0;
const englishItemEls: HTMLElement[] = [];
let englishDraggableItem: HTMLElement | null = null;

document.addEventListener('mouseup', () => {
  if (englishDraggableItem) {
    englishDraggableItem.draggable = false;
    englishDraggableItem = null;
  }
});

function calcEnglishInsertIndex(clientY: number): number {
  for (let i = 0; i < englishItemEls.length; i++) {
    if (i === englishDragSrcIndex) {
      continue;
    }
    const rect = englishItemEls[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return i;
    }
  }
  return englishValues.length;
}

function applyEnglishTransforms() {
  const src = englishDragSrcIndex;
  const ins = englishInsertIndex;
  if (src === null || ins === null) {
    return;
  }
  for (let i = 0; i < englishItemEls.length; i++) {
    if (i === src) {
      continue;
    }
    let shift = 0;
    if (ins > src && i > src && i < ins) {
      shift = -englishStride;
    } else if (ins < src && i >= ins && i < src) {
      shift = englishStride;
    }
    englishItemEls[i].style.transform = shift ? `translateY(${shift}px)` : '';
  }
}

function clearEnglishTransforms() {
  englishItemEls.forEach((el) => (el.style.transform = ''));
}

document.addEventListener('dragover', (e) => {
  if (englishDragSrcIndex === null) {
    return;
  }
  e.preventDefault();
  const newIns = calcEnglishInsertIndex(e.clientY);
  if (newIns !== englishInsertIndex) {
    englishInsertIndex = newIns;
    applyEnglishTransforms();
  }
});

document.addEventListener('drop', (e) => {
  if (englishDragSrcIndex === null) {
    return;
  }
  e.preventDefault();
  const src = englishDragSrcIndex;
  const ins = englishInsertIndex;
  englishDragSrcIndex = null;
  englishInsertIndex = null;
  if (ins === null || ins === src || ins === src + 1) {
    return;
  }
  const [moved] = englishValues.splice(src, 1);
  englishValues.splice(src < ins ? ins - 1 : ins, 0, moved);
  renderEnglishList();
});

function renderEnglishList() {
  englishList.innerHTML = '';
  englishItemEls.length = 0;

  englishValues.forEach((val, i) => {
    const item = document.createElement('div');
    item.className = 'english-item';
    englishItemEls.push(item);

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.addEventListener('mousedown', () => {
      item.draggable = true;
      englishDraggableItem = item;
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'english-item-input';
    input.value = val;
    input.addEventListener('input', () => {
      englishValues[i] = input.value;
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'english-item-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      englishValues.splice(i, 1);
      renderEnglishList();
    });

    item.addEventListener('dragstart', (e) => {
      englishDragSrcIndex = i;
      e.dataTransfer!.effectAllowed = 'move';
      if (englishItemEls.length > 1) {
        const a = englishItemEls[0].getBoundingClientRect().top;
        const b = englishItemEls[1].getBoundingClientRect().top;
        englishStride = b - a;
      } else {
        englishStride = item.offsetHeight;
      }
      setTimeout(() => item.classList.add('dragging'), 0);
    });
    item.addEventListener('dragend', () => {
      item.draggable = false;
      englishDraggableItem = null;
      item.classList.remove('dragging');
      clearEnglishTransforms();
      englishDragSrcIndex = null;
      englishInsertIndex = null;
    });

    item.append(handle, input, removeBtn);
    englishList.appendChild(item);
  });
}

function addEnglishItem(value: string) {
  const trimmed = value.trim();
  if (trimmed && !englishValues.includes(trimmed)) {
    englishValues.push(trimmed);
    renderEnglishList();
  }
  addEnglishInput.value = '';
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

addEnglishInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addEnglishItem(addEnglishInput.value);
  }
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
    const { entries, existing, maxBucket, breakdown, wordRank, charRank } = await lookupHanzi(hanzi);

    if (existing) {
      editingExistingWord = true;
      queueAsNewCb.checked = maxBucket === null;
      addWordBtn.textContent = 'Save';
      resetProgressBtn.classList.remove('hidden');
      addPinyinInput.value = existing.pinyin;
      englishValues = [...existing.english];
      renderEnglishList();
      categoryValues = [...existing.categories];
      ensureCurated();
      renderChips(categoryChips, categoryValues, removeCategoryChip);

      const infoParts: string[] = [];
      if (wordRank != null) infoParts.push(`word #${wordRank}`);
      if (charRank != null) infoParts.push(`char #${charRank}`);
      infoParts.push(`Bucket: ${maxBucket ?? 'new'}`);
      wordInfoDiv.textContent = infoParts.join(' · ');
      wordInfoDiv.classList.remove('hidden');
    } else {
      editingExistingWord = false;
      queueAsNewCb.checked = true;
      addWordBtn.textContent = 'Add';
      resetProgressBtn.classList.add('hidden');
      addPinyinInput.value = '';
      addEnglishInput.value = '';
      addCategoriesInput.value = '';
      englishValues = [];
      categoryValues = [];
      ensureCurated();
      renderEnglishList();
      renderChips(categoryChips, categoryValues, removeCategoryChip);
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
        englishValues = [...entries[0].definitions];
        renderEnglishList();
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
    addEnglishInput.value = '';
    addCategoriesInput.value = '';
    englishValues = [];
    categoryValues = [];
    ensureCurated();
    renderEnglishList();
    renderChips(categoryChips, categoryValues, removeCategoryChip);
    cedictEntries.classList.add('hidden');
    wordInfoDiv.classList.add('hidden');
    wordBreakdown.classList.add('hidden');
    editingExistingWord = false;
    queueAsNewCb.checked = true;
    addWordBtn.textContent = 'Add';
    resetProgressBtn.classList.add('hidden');
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
      englishValues = [...entry.definitions];
      renderEnglishList();
    });
    cedictEntries.appendChild(div);
  }
}

addWordBtn.addEventListener('click', async () => {
  const hanzi = addHanziInput.value.trim();
  const pinyin = addPinyinInput.value.trim();

  if (!hanzi || !pinyin || englishValues.length === 0) {
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

    if (editingExistingWord) {
      const updated = await updateWord(
        hanzi,
        pinyin,
        englishValues,
        categoryValues,
        queueAsNewCb.checked
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
          q.word.categories = updated.categories;
          if (currentMode === 'english2hanzi' || currentMode === 'english2pinyin') {
            q.prompt = englishPrompt;
          }
          if (currentMode === 'hanzi2pinyin' || currentMode === 'english2pinyin') {
            q.acceptedAnswers = [numberedPinyin];
          }
        }
      }
    } else {
      await addWord(hanzi, pinyin, englishValues, categoryValues, queueAsNewCb.checked);
      showAddWordStatus(`Added "${hanzi}" successfully!`, 'success');
    }

    // Reset form
    addHanziInput.value = '';
    addPinyinInput.value = '';
    addEnglishInput.value = '';
    addCategoriesInput.value = '';
    englishValues = [];
    categoryValues = [];
    editingExistingWord = false;
    renderEnglishList();
    renderChips(categoryChips, categoryValues, removeCategoryChip);
    cedictEntries.classList.add('hidden');
    wordInfoDiv.classList.add('hidden');
    wordBreakdown.classList.add('hidden');
    resetProgressBtn.classList.add('hidden');

    // Reload stats and categories
    loadStats();

    // Return to practice if editing from practice screen
    if (returnToPractice) {
      returnToPractice = false;
      cancelEditBtn.classList.add('hidden');
      showView('practice');
    }
  } catch (error) {
    showAddWordStatus(error instanceof Error ? error.message : 'Failed to save word', 'error');
  } finally {
    addWordBtn.disabled = false;
    addWordBtn.textContent = editingExistingWord ? 'Save' : 'Add';
  }
});

function showAddWordStatus(message: string, type: 'success' | 'error') {
  addWordStatus.textContent = message;
  addWordStatus.className = `add-word-status ${type}`;
  addWordStatus.classList.remove('hidden');
  setTimeout(() => addWordStatus.classList.add('hidden'), 5000);
}

// Initialize
if (!restoreSession()) {
  showScreen(startScreen);
}
loadStats();
