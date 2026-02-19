import type { PracticeMode, PracticeQuestion, WordProgress, CedictEntry } from './services.js';
import {
  addWord,
  completePractice,
  getCategories,
  getDueCount,
  getStats,
  getWordCount,
  lookupHanzi,
  markPinyinSynonym,
  startPractice,
  submitAnswer,
  updateWord,
} from './services.js';

// DOM Elements
const startScreen = document.getElementById('start-screen')!;
const practiceScreen = document.getElementById('practice-screen')!;
const resultScreen = document.getElementById('result-screen')!;
const addWordScreen = document.getElementById('add-word-screen')!;

const wordCountInput = document.getElementById('word-count') as HTMLInputElement;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const statsDiv = document.getElementById('stats')!;

const progressText = document.getElementById('progress-text')!;
const promptDiv = document.getElementById('prompt')!;
const answerInput = document.getElementById('answer-input') as HTMLInputElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
const feedbackDiv = document.getElementById('feedback')!;
const nextBtn = document.getElementById('next-btn')!;
const skipBtn = document.getElementById('skip-btn')!;

const resultStatsDiv = document.getElementById('result-stats')!;
const mistakesSection = document.getElementById('mistakes-section')!;
const mistakesList = document.getElementById('mistakes-list')!;
const restartBtn = document.getElementById('restart-btn')!;
const categoryToggle = document.getElementById('category-toggle')!;
const categoryToggleText = document.getElementById('category-toggle-text')!;
const categoryMenu = document.getElementById('category-menu')!;
const categorySearch = document.getElementById('category-search') as HTMLInputElement;
const categoryList = document.getElementById('category-list')!;
const selectedCategoriesDiv = document.getElementById('selected-categories')!;
const categoryDropdown = categoryToggle.parentElement!;
const autoplayCheckbox = document.getElementById('autoplay-audio') as HTMLInputElement;
const characterModeCheckbox = document.getElementById('character-mode') as HTMLInputElement;
const dueBtn = document.getElementById('due-btn') as HTMLButtonElement;

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
  }
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const view = (item as HTMLElement).dataset.view as 'practice' | 'add-word';
    showView(view);
  });
});

// Load preferences from localStorage
autoplayCheckbox.checked = localStorage.getItem('autoplayAudio') !== 'false';
autoplayCheckbox.addEventListener('change', () => {
  localStorage.setItem('autoplayAudio', String(autoplayCheckbox.checked));
});
characterModeCheckbox.checked = localStorage.getItem('characterMode') === 'true';
characterModeCheckbox.addEventListener('change', () => {
  localStorage.setItem('characterMode', String(characterModeCheckbox.checked));
  reloadStats();
});
const savedWordCount = localStorage.getItem('wordCount');
if (savedWordCount) wordCountInput.value = savedWordCount;
wordCountInput.addEventListener('change', () => {
  localStorage.setItem('wordCount', wordCountInput.value);
});
const savedMode = localStorage.getItem('mode');
if (savedMode) {
  const radio = document.querySelector(`input[name="mode"][value="${savedMode}"]`) as HTMLInputElement | null;
  if (radio) radio.checked = true;
}
document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    currentMode = (radio as HTMLInputElement).value as PracticeMode;
    localStorage.setItem('mode', currentMode);
    updateDueBtn();
  });
});
const savedWordSelection = localStorage.getItem('wordSelection');
if (savedWordSelection) {
  const radio = document.querySelector(`input[name="word-selection"][value="${savedWordSelection}"]`) as HTMLInputElement | null;
  if (radio) radio.checked = true;
}
document.querySelectorAll('input[name="word-selection"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    localStorage.setItem('wordSelection', (radio as HTMLInputElement).value);
  });
});

// State
let latestStats: { mode: PracticeMode; dueForReview: number }[] = [];
let currentMode: PracticeMode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement)?.value as PracticeMode || 'hanzi2pinyin';
let questions: PracticeQuestion[] = [];
let currentIndex = 0;
let results: Map<string, number> = new Map(); // hanzi -> round answered correctly (1 = first try)
let allQuestions: PracticeQuestion[] = []; // original question list for results display
let incorrectThisRound: PracticeQuestion[] = [];
let roundNumber = 1;
let submitBlocked = false;
let newWords: Set<string> = new Set(); // words that were new (bucket null) and shown answer on first round

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

function updateDueBtn() {
  const stat = latestStats.find((s) => s.mode === currentMode);
  const due = stat?.dueForReview ?? 0;
  dueBtn.textContent = 'all due';
  dueBtn.dataset.count = String(due);
}

const MODE_LABELS: Record<PracticeMode, string> = {
  hanzi2pinyin: 'Hanzi → Pinyin',
  hanzi2english: 'Hanzi → English',
  english2hanzi: 'English → Hanzi',
  english2pinyin: 'English → Pinyin',
};

// Category selection state
const savedCategories = localStorage.getItem('selectedCategories');
let selectedCategories: Set<string> = savedCategories ? new Set(JSON.parse(savedCategories)) : new Set();

function updateCategoryToggleText() {
  if (selectedCategories.size === 0) {
    categoryToggleText.textContent = 'All categories';
  } else {
    categoryToggleText.textContent = `${selectedCategories.size} selected`;
  }
}

function updateSelectedTags() {
  selectedCategoriesDiv.innerHTML = '';
  for (const cat of selectedCategories) {
    const tag = document.createElement('span');
    tag.className = 'selected-tag';
    tag.innerHTML = `${cat}<button type="button" class="selected-tag-remove" data-category="${cat}">×</button>`;
    selectedCategoriesDiv.appendChild(tag);
  }
}

function toggleCategory(cat: string, checked: boolean) {
  if (checked) {
    selectedCategories.add(cat);
  } else {
    selectedCategories.delete(cat);
  }
  localStorage.setItem('selectedCategories', JSON.stringify([...selectedCategories]));
  updateCategoryToggleText();
  updateSelectedTags();
  // Sync checkbox state
  const checkbox = categoryList.querySelector(`input[value="${CSS.escape(cat)}"]`) as HTMLInputElement | null;
  if (checkbox) checkbox.checked = checked;
  reloadStats();
}

// Load stats on start
async function loadStats() {
  try {
    const [stats, wordCount, categories] = await Promise.all([
      getStats(getSelectedCategories(), characterModeCheckbox.checked),
      getWordCount(),
      getCategories(),
    ]);
    allCategoriesList = categories;

    // Populate category dropdown list
    categoryList.innerHTML = '';
    const numRows = Math.ceil(categories.length / 3);
    categoryList.style.gridTemplateRows = `repeat(${numRows}, auto)`;
    for (const cat of categories) {
      const label = document.createElement('label');
      label.className = 'category-item';
      label.dataset.category = cat;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = cat;
      checkbox.checked = selectedCategories.has(cat);
      checkbox.addEventListener('change', () => toggleCategory(cat, checkbox.checked));
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(cat));
      categoryList.appendChild(label);
    }
    updateCategoryToggleText();
    updateSelectedTags();

    if (wordCount === 0) {
      statsDiv.innerHTML =
        '<p>No words in database. Run <code>npm run import-hsk</code> first.</p>';
      startBtn.disabled = true;
      return;
    }

    renderStats(stats);
  } catch (error) {
    console.error('Failed to load stats:', error);
    statsDiv.innerHTML = '<p>Failed to load stats</p>';
  }
}

function renderStats(stats: { mode: PracticeMode; learned: number; totalWords: number; mastered: number; dueForReview: number; buckets: number[] }[]) {
  const html = stats
    .filter((s) => s.mode !== 'hanzi2english')
    .map(
      (s) => {
        const bucketBar = s.buckets
          .map((count, i) => `<span class="bucket-count" title="Bucket ${i}">${count}</span>`)
          .join('');
        return `
      <p><strong>${MODE_LABELS[s.mode] ?? s.mode}:</strong> ${s.learned}/${s.totalWords} learned, ${s.mastered} mastered, ${s.dueForReview} due</p>
      <div class="bucket-bar">${bucketBar}</div>
    `;
      }
    )
    .join('');

  statsDiv.innerHTML = html;
  latestStats = stats;
  updateDueBtn();
}

async function reloadStats() {
  try {
    const stats = await getStats(getSelectedCategories(), characterModeCheckbox.checked);
    renderStats(stats);
  } catch (error) {
    console.error('Failed to reload stats:', error);
  }
}

function getSelectedCategories(): string[] {
  return Array.from(selectedCategories);
}

// Start practice
async function handleStart() {
  const count = parseInt(wordCountInput.value) || 10;
  currentMode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement)
    .value as PracticeMode;

  try {
    startBtn.disabled = true;
    startBtn.textContent = 'Loading...';

    const selectedCategories = getSelectedCategories();
    const wordSelection = (document.querySelector('input[name="word-selection"]:checked') as HTMLInputElement).value;
    const response = await startPractice(count, currentMode, wordSelection, selectedCategories, characterModeCheckbox.checked);
    questions = shuffle(response.questions);
    allQuestions = [...questions];
    currentIndex = 0;
    results.clear();
    incorrectThisRound = [];
    roundNumber = 1;
    newWords.clear();

    showScreen(practiceScreen);
    showQuestion();
  } catch (error) {
    alert(error instanceof Error ? error.message : 'Failed to start practice');
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = 'Start Practice';
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
function formatExampleHints(
  examples: { hanzi: string; pinyin: string; english: string }[]
): string {
  if (currentMode === 'english2hanzi' || currentMode === 'english2pinyin') {
    // english->X: show english only (to not give away the answer)
    return examples.map((ex) => `<span class="ex-english">${ex.english}</span>`).join('<br>');
  } else {
    // hanzi->X modes: show clickable example hanzi
    return examples.map((ex) => clickableHanzi(ex.hanzi, 'ex-hanzi')).join('<br>');
  }
}

// Format full examples for answer
function formatExampleAnswers(
  examples: { hanzi: string; pinyin: string; english: string }[]
): string {
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

  const ranks = [
    word.wordFrequencyRank != null ? `word #${word.wordFrequencyRank}` : null,
    word.hanziFrequencyRank != null ? `char #${word.hanziFrequencyRank}` : null,
  ].filter(Boolean).join(', ') || '?';
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
    if (word.examples.length > 0) {
      promptDiv.innerHTML = `${clickablePrompt}<div class="example-hint">${formatExampleHints(word.examples)}</div>`;
    } else {
      promptDiv.innerHTML = clickablePrompt;
    }
  }
  promptDiv.className = (currentMode === 'english2hanzi' || currentMode === 'english2pinyin') ? 'prompt english-prompt' : 'prompt';

  answerInput.value = '';

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
    nextBtn.classList.remove('hidden');
    // Don't set results — will be retried in next round
    incorrectThisRound.push(question);
  } else {
    answerInput.disabled = false;
    answerInput.focus();
    feedbackDiv.classList.add('hidden');
    nextBtn.classList.add('hidden');
    submitBtn.classList.remove('hidden');
    skipBtn.classList.remove('hidden');
  }
}

// Format character breakdown
function formatBreakdown(
  breakdown: { hanzi: string; pinyin: string; meaning: string }[]
): string {
  if (breakdown.length === 0) return '';

  const items = breakdown
    .map(
      (char) =>
        `<div class="breakdown-item"><span class="char-hanzi">${char.hanzi}</span> <span class="breakdown-pinyin">(${char.pinyin})</span> <span class="breakdown-meaning">${char.meaning}</span></div>`
    )
    .join('');

  return `<div class="character-breakdown">${items}</div>`;
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
      .map((w) => `<span class="containing-word">${clickableHanzi(w.hanzi, 'containing-hanzi')} <span class="containing-pinyin">(${w.pinyin})</span> <span class="containing-english">${w.english[0]}</span></span>`)
      .join('');
    result += `<div class="containing-words"><span class="containing-label">Words with ${word.hanzi}:</span>${items}</div>`;
  }

  return result;
}

// Handle answer submission
async function handleSubmit() {
  const answer = answerInput.value.trim();
  if (!answer) return;

  const question = questions[currentIndex];

  try {
    submitBtn.disabled = true;
    const response = await submitAnswer(currentMode, question.word.hanzi, answer);

    // Handle synonym case - valid word but not the target
    if (response.synonym) {
      feedbackDiv.classList.remove('hidden', 'correct', 'incorrect');
      feedbackDiv.classList.add('synonym');
      feedbackDiv.innerHTML = `✓ "${answer}" is correct, but not the word I'm looking for. Try again!`;
      answerInput.focus();
      submitBtn.disabled = false;

      // Block Enter until user types something or 1 second elapses
      submitBlocked = true;
      const unblock = () => { submitBlocked = false; };
      const timer = setTimeout(unblock, 1000);
      answerInput.addEventListener('input', () => {
        clearTimeout(timer);
        unblock();
      }, { once: true });

      return;
    }

    // Track round when answered correctly
    if (response.correct && !results.has(question.word.hanzi)) {
      results.set(question.word.hanzi, roundNumber);
    }
    // Track for iteration retry (always, if wrong)
    if (!response.correct) {
      incorrectThisRound.push(question);
    }

    // Show feedback
    feedbackDiv.classList.remove('hidden', 'correct', 'incorrect', 'synonym');
    feedbackDiv.classList.add(response.correct ? 'correct' : 'incorrect');

    if (response.correct) {
      feedbackDiv.innerHTML = `✓ Correct!<div class="correct-answer">${formatFullAnswer(question)}</div>`;
    } else {
      const isPinyinMode = currentMode === 'english2pinyin' || currentMode === 'hanzi2pinyin';
      const synonymBtn = isPinyinMode
        ? `<button class="synonym-btn" id="synonym-btn">Synonym</button>`
        : '';
      feedbackDiv.innerHTML = `✗ Incorrect${synonymBtn}<div class="correct-answer">${formatFullAnswer(question)}</div>`;

      if (isPinyinMode) {
        document.getElementById('synonym-btn')!.addEventListener('click', async () => {
          try {
            await markPinyinSynonym(question.word.hanzi, answer);
            // Undo incorrect tracking
            incorrectThisRound = incorrectThisRound.filter((q) => q !== question);
            results.delete(question.word.hanzi);
            // Show synonym message and let user retry
            feedbackDiv.classList.remove('incorrect');
            feedbackDiv.classList.add('synonym');
            feedbackDiv.innerHTML = `✓ "${answer}" saved as synonym. Try again!`;
            answerInput.value = '';
            answerInput.disabled = false;
            answerInput.focus();
            submitBtn.classList.remove('hidden');
            skipBtn.classList.remove('hidden');
            nextBtn.classList.add('hidden');

            submitBlocked = true;
            const unblock = () => { submitBlocked = false; };
            const timer = setTimeout(unblock, 1000);
            answerInput.addEventListener('input', () => {
              clearTimeout(timer);
              unblock();
            }, { once: true });
          } catch (error) {
            console.error('Failed to mark synonym:', error);
          }
        });
      }
    }

    // Play word pronunciation (auto)
    playAudio(question.word.hanzi, true);

    submitBtn.classList.add('hidden');
    skipBtn.classList.add('hidden');
    nextBtn.classList.remove('hidden');
    answerInput.disabled = true;
  } catch (error) {
    alert(error instanceof Error ? error.message : 'Failed to submit answer');
  } finally {
    submitBtn.disabled = false;
  }
}

// Handle "I don't know" button
function handleSkip() {
  const question = questions[currentIndex];

  // Track for iteration retry
  incorrectThisRound.push(question);

  // Show the correct answer
  feedbackDiv.classList.remove('hidden', 'correct', 'incorrect');
  feedbackDiv.classList.add('incorrect');
  feedbackDiv.innerHTML = `<div class="correct-answer">${formatFullAnswer(question)}</div>`;

  // Play word pronunciation (auto)
  playAudio(question.word.hanzi, true);

  submitBtn.classList.add('hidden');
  skipBtn.classList.add('hidden');
  nextBtn.classList.remove('hidden');
  answerInput.disabled = true;
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
    } else {
      // All done
      finishPractice();
    }
  } else {
    showQuestion();
  }
}

// Finish practice session
async function finishPractice() {
  try {
    const resultArray = Array.from(results.entries()).map(([hanzi, round]) => ({
      hanzi,
      correctFirstTry: newWords.has(hanzi) ? round === 2 : round === 1,
    }));

    const response = await completePractice(currentMode, resultArray, characterModeCheckbox.checked);
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
        const label = firstTry ? '✓' : round !== undefined ? `try ${isNew ? round - 1 : round}` : '?';
        const className = firstTry ? 'result-correct' : 'result-retry';
        const progressInfo = prog ? `<span class="progress-info">B${prog.bucket} · ${formatNextEligible(prog.nextEligible)}</span>` : '';
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

// Event listeners
startBtn.addEventListener('click', handleStart);
submitBtn.addEventListener('click', handleSubmit);
skipBtn.addEventListener('click', handleSkip);
nextBtn.addEventListener('click', handleNext);
restartBtn.addEventListener('click', handleRestart);

answerInput.addEventListener('keydown', (e) => {
  // Ignore Enter during IME composition (e.g. pinyin input)
  if (e.isComposing) return;
  if (e.key === 'Enter' && !submitBtn.classList.contains('hidden') && !submitBlocked) {
    if (answerInput.value.trim() === '') {
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
    } else if (startScreen.classList.contains('active')) {
      handleStart();
    } else if (!nextBtn.classList.contains('hidden')) {
      handleNext();
    }
  }
});

// Preset count buttons
document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    wordCountInput.value = (btn as HTMLElement).dataset.count!;
    localStorage.setItem('wordCount', wordCountInput.value);
  });
});

// "All due" button: set review-only mode with due count respecting categories
dueBtn.addEventListener('click', async () => {
  const reviewRadio = document.querySelector('input[name="word-selection"][value="review"]') as HTMLInputElement;
  reviewRadio.checked = true;
  localStorage.setItem('wordSelection', 'review');

  try {
    const count = await getDueCount(currentMode, getSelectedCategories(), characterModeCheckbox.checked);
    if (count > 0) {
      wordCountInput.value = String(count);
      localStorage.setItem('wordCount', String(count));
    }
  } catch (error) {
    console.error('Failed to get due count:', error);
  }
});

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

// Category dropdown handlers
categoryToggle.addEventListener('click', () => {
  const isOpen = !categoryMenu.classList.contains('hidden');
  if (isOpen) {
    categoryMenu.classList.add('hidden');
    categoryDropdown.classList.remove('open');
  } else {
    categoryMenu.classList.remove('hidden');
    categoryDropdown.classList.add('open');
    categorySearch.value = '';
    categorySearch.focus();
    // Reset filter
    categoryList.querySelectorAll('.category-item').forEach((item) => {
      (item as HTMLElement).classList.remove('hidden');
    });
  }
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!categoryDropdown.contains(e.target as Node)) {
    categoryMenu.classList.add('hidden');
    categoryDropdown.classList.remove('open');
  }
});

// Category search filter
categorySearch.addEventListener('input', () => {
  const query = categorySearch.value.toLowerCase();
  categoryList.querySelectorAll('.category-item').forEach((item) => {
    const cat = (item as HTMLElement).dataset.category?.toLowerCase() || '';
    if (cat.includes(query)) {
      (item as HTMLElement).classList.remove('hidden');
    } else {
      (item as HTMLElement).classList.add('hidden');
    }
  });
});

// Remove tag handler
selectedCategoriesDiv.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('selected-tag-remove')) {
    const cat = target.dataset.category;
    if (cat) {
      toggleCategory(cat, false);
    }
  }
});

// Add word form
const addWordForm = document.getElementById('add-word-screen')!;
const addHanziInput = document.getElementById('add-hanzi') as HTMLInputElement;
const addPinyinInput = document.getElementById('add-pinyin') as HTMLInputElement;
const addEnglishInput = document.getElementById('add-english') as HTMLInputElement;
const addCategoriesInput = document.getElementById('add-categories') as HTMLInputElement;
const englishChips = document.getElementById('english-chips')!;
const categoryChips = document.getElementById('category-chips')!;
const cedictEntries = document.getElementById('cedict-entries')!;
const categorySuggestions = document.getElementById('category-suggestions')!;
const addWordBtn = document.getElementById('add-word-btn') as HTMLButtonElement;
const addWordStatus = document.getElementById('add-word-status')!;

let englishValues: string[] = [];
let categoryValues: string[] = [];
let allCategoriesList: string[] = [];
let lookupTimer: ReturnType<typeof setTimeout> | null = null;
let editingExistingWord = false;

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

function addEnglishChip(value: string) {
  const trimmed = value.trim();
  if (trimmed && !englishValues.includes(trimmed)) {
    englishValues.push(trimmed);
    renderChips(englishChips, englishValues, removeEnglishChip);
  }
  addEnglishInput.value = '';
}

function removeEnglishChip(index: number) {
  englishValues.splice(index, 1);
  renderChips(englishChips, englishValues, removeEnglishChip);
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
    addEnglishChip(addEnglishInput.value);
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

// Debounced CEDICT lookup + existing word check
addHanziInput.addEventListener('input', () => {
  if (lookupTimer) clearTimeout(lookupTimer);
  const hanzi = addHanziInput.value.trim();
  if (!hanzi) {
    cedictEntries.classList.add('hidden');
    editingExistingWord = false;
    addWordBtn.textContent = 'Add';
    return;
  }
  lookupTimer = setTimeout(async () => {
    try {
      const { entries, existing } = await lookupHanzi(hanzi);

      if (existing) {
        editingExistingWord = true;
        addWordBtn.textContent = 'Save';
        addPinyinInput.value = existing.pinyin;
        englishValues = [...existing.english];
        renderChips(englishChips, englishValues, removeEnglishChip);
        categoryValues = [...existing.categories];
        renderChips(categoryChips, categoryValues, removeCategoryChip);
      } else {
        editingExistingWord = false;
        addWordBtn.textContent = 'Add';
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
          renderChips(englishChips, englishValues, removeEnglishChip);
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
  }, 300);
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
      renderChips(englishChips, englishValues, removeEnglishChip);
    });
    cedictEntries.appendChild(div);
  }
}

addWordBtn.addEventListener('click', async () => {
  const hanzi = addHanziInput.value.trim();
  const pinyin = addPinyinInput.value.trim();

  if (!hanzi || !pinyin || englishValues.length === 0) {
    showAddWordStatus('Please fill in hanzi, pinyin, and at least one English translation', 'error');
    return;
  }

  try {
    addWordBtn.disabled = true;
    addWordBtn.textContent = editingExistingWord ? 'Saving...' : 'Adding...';

    if (editingExistingWord) {
      await updateWord(hanzi, pinyin, englishValues, categoryValues);
      showAddWordStatus(`Updated "${hanzi}" successfully!`, 'success');
    } else {
      await addWord(hanzi, pinyin, englishValues, categoryValues);
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
    renderChips(englishChips, englishValues, removeEnglishChip);
    renderChips(categoryChips, categoryValues, removeCategoryChip);
    cedictEntries.classList.add('hidden');

    // Reload stats
    loadStats();
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
loadStats();
