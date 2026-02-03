import type { PracticeMode, PracticeQuestion } from './services.js';
import {
  completePractice,
  getCategories,
  getStats,
  getWordCount,
  startPractice,
  submitAnswer,
} from './services.js';

// DOM Elements
const startScreen = document.getElementById('start-screen')!;
const practiceScreen = document.getElementById('practice-screen')!;
const resultScreen = document.getElementById('result-screen')!;

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

// Load autoplay preference from localStorage
autoplayCheckbox.checked = localStorage.getItem('autoplayAudio') !== 'false';
autoplayCheckbox.addEventListener('change', () => {
  localStorage.setItem('autoplayAudio', String(autoplayCheckbox.checked));
});

// State
let currentMode: PracticeMode = 'hanzi2pinyin';
let questions: PracticeQuestion[] = [];
let currentIndex = 0;
let results: Map<string, boolean> = new Map(); // hanzi -> correctFirstTry
let incorrectThisRound: PracticeQuestion[] = [];
let submitBlocked = false;

// Utility functions
function showScreen(screen: HTMLElement) {
  startScreen.classList.remove('active');
  practiceScreen.classList.remove('active');
  resultScreen.classList.remove('active');
  screen.classList.add('active');
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
  hanzi2english: 'Hanzi → English',
  english2hanzi: 'English → Hanzi',
  english2pinyin: 'English → Pinyin',
};

// Category selection state
let selectedCategories: Set<string> = new Set();

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
  updateCategoryToggleText();
  updateSelectedTags();
  // Sync checkbox state
  const checkbox = categoryList.querySelector(`input[value="${CSS.escape(cat)}"]`) as HTMLInputElement | null;
  if (checkbox) checkbox.checked = checked;
}

// Load stats on start
async function loadStats() {
  try {
    const [stats, wordCount, categories] = await Promise.all([getStats(), getWordCount(), getCategories()]);

    // Populate category dropdown list
    categoryList.innerHTML = '';
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

    const html = stats
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
  } catch (error) {
    console.error('Failed to load stats:', error);
    statsDiv.innerHTML = '<p>Failed to load stats</p>';
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
    const response = await startPractice(count, currentMode, wordSelection, selectedCategories.length > 0 ? selectedCategories : undefined);
    questions = shuffle(response.questions);
    currentIndex = 0;
    results.clear();
    incorrectThisRound = [];

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
  const bucketLabel = question.bucket === null ? 'new' : `bucket ${question.bucket}`;

  progressText.textContent = `Question ${currentIndex + 1} of ${questions.length} (${bucketLabel}, rank #${word.frequencyRank})`;

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
  answerInput.disabled = false;
  answerInput.focus();

  feedbackDiv.classList.add('hidden');
  nextBtn.classList.add('hidden');
  submitBtn.classList.remove('hidden');
  skipBtn.classList.remove('hidden');
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

  // Show example answers
  if (word.examples.length > 0) {
    result += `<div class="example-sentence">${formatExampleAnswers(word.examples)}</div>`;
  }

  // Show character breakdown for multi-character words (at the bottom)
  if (word.breakdown && word.breakdown.length > 0) {
    result += formatBreakdown(word.breakdown);
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
      answerInput.value = '';
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

    // Track first attempt for bucket calculation
    if (!results.has(question.word.hanzi)) {
      results.set(question.word.hanzi, response.correct);
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
      feedbackDiv.innerHTML = `✗ Incorrect<div class="correct-answer">${formatFullAnswer(question)}</div>`;
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

  // Track first attempt for bucket calculation
  if (!results.has(question.word.hanzi)) {
    results.set(question.word.hanzi, false);
  }
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
    const resultArray = Array.from(results.entries()).map(([hanzi, correctFirstTry]) => ({
      hanzi,
      correctFirstTry,
    }));

    await completePractice(currentMode, resultArray);

    // Show results
    const correctCount = resultArray.filter((r) => r.correctFirstTry).length;
    const incorrectCount = resultArray.length - correctCount;

    resultStatsDiv.innerHTML = `
      <p class="success">✓ ${correctCount} correct on first try</p>
      <p class="retry">✗ ${incorrectCount} needed retry</p>
    `;

    // Show mistakes
    const mistakes = resultArray
      .filter((r) => !r.correctFirstTry)
      .map((r) => questions.find((q) => q.word.hanzi === r.hanzi)!)
      .filter(Boolean);

    if (mistakes.length > 0) {
      mistakesSection.classList.remove('hidden');
      mistakesList.innerHTML = mistakes
        .map(
          (q) => `
        <li>
          ${clickableHanzi(q.word.hanzi, 'hanzi')}
          <span class="details">(${q.word.pinyin}) - ${q.word.english[0]}</span>
        </li>
      `
        )
        .join('');
    } else {
      mistakesSection.classList.add('hidden');
    }

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
  });
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

// Initialize
loadStats();
