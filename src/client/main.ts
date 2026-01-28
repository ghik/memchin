import type { PracticeMode, PracticeQuestion } from './services.js';
import {
  completePractice,
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
const autoplayCheckbox = document.getElementById('autoplay-audio') as HTMLInputElement;

// Load autoplay preference from localStorage
autoplayCheckbox.checked = localStorage.getItem('autoplayAudio') !== 'false';
autoplayCheckbox.addEventListener('change', () => {
  localStorage.setItem('autoplayAudio', String(autoplayCheckbox.checked));
});

// State
let currentMode: PracticeMode = 'pinyin';
let questions: PracticeQuestion[] = [];
let currentIndex = 0;
let results: Map<number, boolean> = new Map(); // wordId -> correctFirstTry
let incorrectThisRound: PracticeQuestion[] = [];

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

// Load stats on start
async function loadStats() {
  try {
    const [stats, wordCount] = await Promise.all([getStats(), getWordCount()]);

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
      <p><strong>${s.mode}:</strong> ${s.learned}/${s.totalWords} learned, ${s.mastered} mastered, ${s.dueForReview} due</p>
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

    const response = await startPractice(count, currentMode);
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
  if (currentMode === 'hanzi') {
    // english->hanzi: show english only (to not give away the answer)
    return examples.map((ex) => `<span class="ex-english">${ex.english}</span>`).join('<br>');
  } else {
    // pinyin and english modes (hanzi->X): show clickable example hanzi
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
  if (currentMode === 'hanzi') {
    // english->hanzi mode: show english prompt, no clickable hanzi
    if (word.examples.length > 0) {
      promptDiv.innerHTML = `${question.prompt}<div class="example-hint">${formatExampleHints(word.examples)}</div>`;
    } else {
      promptDiv.textContent = question.prompt;
    }
  } else {
    // pinyin/english modes: show clickable hanzi prompt
    const clickablePrompt = clickableHanzi(word.hanzi, 'prompt-hanzi');
    if (word.examples.length > 0) {
      promptDiv.innerHTML = `${clickablePrompt}<div class="example-hint">${formatExampleHints(word.examples)}</div>`;
    } else {
      promptDiv.innerHTML = clickablePrompt;
    }
  }
  promptDiv.className = currentMode === 'hanzi' ? 'prompt english-prompt' : 'prompt';

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
    const response = await submitAnswer(currentMode, question.word.id, answer);

    // Handle synonym case - valid word but not the target
    if (response.synonym) {
      feedbackDiv.classList.remove('hidden', 'correct', 'incorrect');
      feedbackDiv.classList.add('synonym');
      feedbackDiv.innerHTML = `✓ "${answer}" is correct, but not the word I'm looking for. Try again!`;
      answerInput.value = '';
      answerInput.focus();
      submitBtn.disabled = false;
      return;
    }

    // Track first attempt for bucket calculation
    if (!results.has(question.word.id)) {
      results.set(question.word.id, response.correct);
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
  if (!results.has(question.word.id)) {
    results.set(question.word.id, false);
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
    const resultArray = Array.from(results.entries()).map(([wordId, correctFirstTry]) => ({
      wordId,
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
      .map((r) => questions.find((q) => q.word.id === r.wordId)!)
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
  if (e.key === 'Enter' && !submitBtn.classList.contains('hidden')) {
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
    if (!nextBtn.classList.contains('hidden')) {
      handleNext();
    } else if (resultScreen.classList.contains('active')) {
      handleRestart();
    }
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

// Initialize
loadStats();
