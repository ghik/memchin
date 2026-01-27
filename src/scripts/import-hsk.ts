import Anthropic from '@anthropic-ai/sdk';
import { initDb, insertWords } from '../server/db.js';
import { toNumberedPinyin } from '../server/services/pinyin.js';
import type { Example } from '../shared/types.js';
import { loadFrequencyData } from './migrate.js';

const anthropic = new Anthropic();

const frequencyData = loadFrequencyData();

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

interface RawWord {
  hanzi: string;
  pinyin: string;
  english: string[];
}

interface WordToInsert {
  hanzi: string;
  pinyin: string;
  pinyinNumbered: string;
  english: string[];
  hskLevel: number;
  frequencyRank: number;
  examples: Example[];
  translatable: boolean;
}

// Check if all translations are enclosed in parentheses (e.g. "(particle)")
function hasTranslatableMeaning(english: string[]): boolean {
  return !english.every((e) => /^\(.*\)$/.test(e.trim()));
}

// Clean up word variants: take longest prefix of letters, numbers, and spaces
function cleanVariant(text: string): string {
  const match = text.match(/^[\p{L}\p{N}\s]+/u);
  return match ? match[0].trim() : text;
}

async function fetchHskLevel(level: number): Promise<RawWord[]> {
  const url = `https://mandarinbean.com/new-hsk-${level}-word-list/`;
  console.log(`Fetching HSK ${level} from ${url}...`);

  const response = await fetch(url);
  const html = await response.text();

  return parseWordTable(html);
}

function parseWordTable(html: string): RawWord[] {
  const words: RawWord[] = [];

  // Match table rows with 4 columns: number, hanzi, pinyin, english
  const rowRegex =
    /<tr[^>]*>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<\/tr>/gi;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const [, num, col2, col3, col4] = match;

    // Skip header rows (check if first column is not a number)
    if (!/^\d+$/.test(num.trim())) {
      continue;
    }

    // Clean up the extracted text and decode HTML entities
    const hanzi = decodeHtmlEntities(col2.trim());
    const pinyin = decodeHtmlEntities(col3.trim());
    const englishText = decodeHtmlEntities(col4.trim());

    // Skip if hanzi doesn't look like Chinese characters
    if (!/[\u4e00-\u9fff]/.test(hanzi)) {
      continue;
    }

    // Parse English translations (split by semicolon)
    const english = englishText
      .split(/[;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (english.length === 0) {
      continue;
    }

    words.push({ hanzi, pinyin, english });
  }

  return words;
}

interface ExampleResponse {
  hanzi: string;
  examples: Example[];
}

const MAX_RETRIES = 10;

async function generateExamples(
  words: { hanzi: string; pinyin: string; english: string[]; hskLevel: number }[],
  numExamples: number
): Promise<Map<string, Example[]>> {
  const wordList = words
    .map((w) => `${w.hanzi} (${w.pinyin}) [HSK ${w.hskLevel}]: ${w.english.join(', ')}`)
    .join('\n');

  const prompt = `Generate ${numExamples} simple example sentence${numExamples > 1 ? 's' : ''} for each Chinese word below. Each sentence should:
- Be a proper sentence with at least a subject and verb
- Be short (5-15 characters)
- Use simple vocabulary: only words at or below the same HSK level as the target word, unless a more advanced word is necessary to provide proper context for the target word's usage
- Clearly demonstrate the meaning of the target word
${numExamples > 1 ? '- Each example should show a different usage or context for the word' : ''}

For each word, provide ${numExamples > 1 ? 'the examples' : 'the example'} in hanzi, pinyin (with tone marks), and English translation.

Output format - one JSON array, no other text:
[{"hanzi": "爱", "examples": [{"hanzi": "我爱你", "pinyin": "wǒ ài nǐ", "english": "I love you"}${numExamples > 1 ? ', {"hanzi": "她爱吃苹果", "pinyin": "tā ài chī píngguǒ", "english": "She loves eating apples"}' : ''}]}, ...]

Words:
${wordList}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const stream = await anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 32000,
      messages: [{ role: 'user', content: prompt }],
    });

    const response = await stream.finalMessage();
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    console.log(`LLM output:\n${content.text}\n`);

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = content.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed: ExampleResponse[] = JSON.parse(jsonText);
      const result = new Map<string, Example[]>();

      for (const item of parsed) {
        result.set(item.hanzi, item.examples);
      }

      return result;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.warn(`JSON parsing failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
      } else {
        throw new Error(`Failed to parse JSON after ${MAX_RETRIES} attempts: ${error}`);
      }
    }
  }

  // Should never reach here, but TypeScript needs this
  throw new Error('Unexpected error in generateExamples');
}

async function importLevels(
  levels: number[],
  numExamples: number,
  start?: number,
  end?: number
): Promise<void> {
  // Initialize database first
  await initDb();

  // Collect all words from all levels first
  let allCleanedWords: { hanzi: string; pinyin: string; english: string[]; hskLevel: number }[] =
    [];

  for (const level of levels) {
    try {
      const rawWords = await fetchHskLevel(level);
      console.log(`Found ${rawWords.length} words for HSK ${level}`);

      const cleanedWords = rawWords.map((raw) => ({
        hanzi: cleanVariant(raw.hanzi),
        pinyin: cleanVariant(raw.pinyin),
        english: raw.english,
        hskLevel: level,
      }));

      allCleanedWords.push(...cleanedWords);
    } catch (error) {
      console.error(`Failed to fetch HSK ${level}:`, error);
    }
  }

  // Sort all words by frequency
  allCleanedWords.sort((a, b) => {
    const rankA = frequencyData.get(a.hanzi) ?? Infinity;
    const rankB = frequencyData.get(b.hanzi) ?? Infinity;
    return rankA - rankB;
  });

  console.log(`Total words fetched: ${allCleanedWords.length}`);

  // Apply start/end filtering if specified (1-indexed)
  const wordOffset = (start ?? 1) - 1;
  if (start !== undefined || end !== undefined) {
    const endIdx = end ?? allCleanedWords.length;
    allCleanedWords = allCleanedWords.slice(wordOffset, endIdx);
    console.log(`Importing words ${wordOffset + 1}-${wordOffset + allCleanedWords.length} only`);
  }

  console.log(`Words to import: ${allCleanedWords.length}`);

  // Generate examples and save in batches of 25
  const batchSize = 25;

  for (let i = 0; i < allCleanedWords.length; i += batchSize) {
    const batch = allCleanedWords.slice(i, i + batchSize);
    const batchStart = wordOffset + i + 1;
    const batchEnd = wordOffset + Math.min(i + batchSize, allCleanedWords.length);
    console.log(`Generating examples for words ${batchStart}-${batchEnd}...`);

    let examples = new Map<string, Example[]>();
    try {
      examples = await generateExamples(batch, numExamples);
    } catch (error) {
      console.error(`Failed to generate examples for batch:`, error);
    }

    // Save batch to database immediately
    const words: WordToInsert[] = batch.map((raw) => {
      const wordExamples = examples.get(raw.hanzi) || [];
      return {
        hanzi: raw.hanzi,
        pinyin: raw.pinyin,
        pinyinNumbered: toNumberedPinyin(raw.pinyin),
        english: raw.english,
        hskLevel: raw.hskLevel,
        frequencyRank: frequencyData.get(raw.hanzi) ?? 999999,
        examples: wordExamples,
        translatable: hasTranslatableMeaning(raw.english),
      };
    });

    insertWords(words);
    console.log(`Saved ${words.length} words to database`);
  }

  console.log(`\nImport complete: ${allCleanedWords.length} words`);
}

// Parse command line arguments
// Usage: npm run import-hsk [--examples=N] [--start=N] [--end=N] [levels]
// Examples:
//   npm run import-hsk                  - imports HSK 1 with 1 example per word
//   npm run import-hsk -- --examples=3  - imports HSK 1 with 3 examples per word
//   npm run import-hsk -- 2 3           - imports HSK 2 and 3
//   npm run import-hsk -- --examples=2 1-6  - imports all levels with 2 examples each
//   npm run import-hsk -- --start=451 --end=475 1-6  - imports only words 451-475
function parseArgs(args: string[]): {
  levels: number[];
  numExamples: number;
  start?: number;
  end?: number;
} {
  let numExamples = 1;
  let start: number | undefined;
  let end: number | undefined;
  const levelArgs: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('--examples=')) {
      numExamples = parseInt(arg.split('=')[1]) || 1;
    } else if (arg.startsWith('-e')) {
      numExamples = parseInt(arg.slice(2)) || 1;
    } else if (arg.startsWith('--start=')) {
      start = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--end=')) {
      end = parseInt(arg.split('=')[1]);
    } else {
      levelArgs.push(arg);
    }
  }

  const levels = parseLevels(levelArgs);
  return { levels, numExamples, start, end };
}

function parseLevels(args: string[]): number[] {
  if (args.length === 0) {
    return [1]; // Default to HSK 1 only
  }

  const levels: number[] = [];
  for (const arg of args) {
    if (arg.includes('-') && !arg.startsWith('-')) {
      // Range like "1-6"
      const [start, end] = arg.split('-').map(Number);
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= 6) levels.push(i);
      }
    } else if (!arg.startsWith('-')) {
      const level = Number(arg);
      if (level >= 1 && level <= 6) levels.push(level);
    }
  }
  return [...new Set(levels)].sort((a, b) => a - b);
}

const { levels, numExamples, start, end } = parseArgs(process.argv.slice(2));
console.log(
  `Importing HSK levels: ${levels.join(', ')} with ${numExamples} example${numExamples > 1 ? 's' : ''} per word`
);
importLevels(levels, numExamples, start, end).catch(console.error);
