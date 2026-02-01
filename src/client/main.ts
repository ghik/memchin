import type { PracticeMode, PracticeQuestion } from './services.js';
import {
  addLabel,
  completePractice,
  getLabels,
  getStats,
  getWordCount,
  removeLabel,
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
const labelFilter = document.getElementById('label-filter') as HTMLSelectElement;
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
let wordLabels: Map<string, string[]> = new Map();
let allKnownLabels: string[] = [];

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

// Load stats on start
async function loadStats() {
  try {
    const [stats, wordCount, labels] = await Promise.all([getStats(), getWordCount(), getLabels()]);

    // Populate label filter dropdown
    allKnownLabels = labels;
    const currentValue = labelFilter.value;
    labelFilter.innerHTML = '<option value="">All words</option>';
    for (const label of labels) {
      const opt = document.createElement('option');
      opt.value = label;
      opt.textContent = label;
      labelFilter.appendChild(opt);
    }
    labelFilter.value = currentValue;

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

// Start practice
async function handleStart() {
  const count = parseInt(wordCountInput.value) || 10;
  currentMode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement)
    .value as PracticeMode;

  try {
    startBtn.disabled = true;
    startBtn.textContent = 'Loading...';

    const selectedLabel = labelFilter.value || undefined;
    const wordSelection = (document.querySelector('input[name="word-selection"]:checked') as HTMLInputElement).value;
    const response = await startPractice(count, currentMode, wordSelection, selectedLabel);
    questions = shuffle(response.questions);
    currentIndex = 0;
    results.clear();
    incorrectThisRound = [];
    wordLabels.clear();
    for (const q of response.questions) {
      wordLabels.set(q.word.hanzi, q.word.labels || []);
    }

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

  progressText.textContent = `Question ${currentIndex + 1} of ${questions.length} (${bucketLabel})`;

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

// Label UI in feedback area
function renderLabelsUI(hanzi: string): string {
  const labels = wordLabels.get(hanzi) || [];
  const tags = labels.map(
    (l) => `<span class="label-tag" data-hanzi="${hanzi}" data-label="${l}">${l}<button class="label-remove" data-hanzi="${hanzi}" data-label="${l}">&times;</button></span>`
  ).join('');

  const datalistOptions = allKnownLabels
    .filter((l) => !labels.includes(l))
    .map((l) => `<option value="${l}">`)
    .join('');

  return `<div class="labels-section">
    <div class="labels-tags">${tags}</div>
    <div class="label-add-row">
      <input type="text" class="label-input" placeholder="Add label..." list="label-suggestions-${hanzi}" data-hanzi="${hanzi}">
      <datalist id="label-suggestions-${hanzi}">${datalistOptions}</datalist>
      <button class="label-add-btn" data-hanzi="${hanzi}">Add</button>
    </div>
  </div>`;
}

function attachLabelHandlers() {
  // Remove label handlers
  feedbackDiv.querySelectorAll('.label-remove').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const el = e.currentTarget as HTMLElement;
      const hanzi = el.dataset.hanzi!;
      const label = el.dataset.label!;
      const result = await removeLabel(hanzi, label);
      wordLabels.set(hanzi, result.labels);
      updateLabelsDisplay(hanzi);
    });
  });

  // Add label handlers
  feedbackDiv.querySelectorAll('.label-add-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const hanzi = (btn as HTMLElement).dataset.hanzi!;
      const input = feedbackDiv.querySelector(`.label-input[data-hanzi="${hanzi}"]`) as HTMLInputElement;
      const label = input.value.trim();
      if (!label) return;
      const result = await addLabel(hanzi, label);
      wordLabels.set(hanzi, result.labels);
      if (!allKnownLabels.includes(label)) {
        allKnownLabels.push(label);
        allKnownLabels.sort();
      }
      input.value = '';
      updateLabelsDisplay(hanzi);
    });
  });

  // Enter key on label input
  feedbackDiv.querySelectorAll('.label-input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const hanzi = (input as HTMLElement).dataset.hanzi!;
        const btn = feedbackDiv.querySelector(`.label-add-btn[data-hanzi="${hanzi}"]`) as HTMLButtonElement;
        btn?.click();
      }
    });
  });
}

function updateLabelsDisplay(hanzi: string) {
  const section = feedbackDiv.querySelector('.labels-section');
  if (section) {
    section.outerHTML = renderLabelsUI(hanzi);
    attachLabelHandlers();
  }
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
      feedbackDiv.innerHTML = `✓ Correct!<div class="correct-answer">${formatFullAnswer(question)}</div>${renderLabelsUI(question.word.hanzi)}`;
    } else {
      feedbackDiv.innerHTML = `✗ Incorrect<div class="correct-answer">${formatFullAnswer(question)}</div>${renderLabelsUI(question.word.hanzi)}`;
    }
    attachLabelHandlers();

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
  feedbackDiv.innerHTML = `<div class="correct-answer">${formatFullAnswer(question)}</div>${renderLabelsUI(question.word.hanzi)}`;
  attachLabelHandlers();

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

// Initialize
loadStats();
