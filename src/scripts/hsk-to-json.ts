import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainHtmlPath = path.join(__dirname, '../../hsk_words.html');
const commonWordsPath = path.join(__dirname, '../../1000_common_words.html');
const labelledDir = path.join(__dirname, '../../hsk_labelled_words');
const freqPath = path.join(__dirname, '../../internet-zh.num.txt');
const outputPath = path.join(__dirname, '../../hsk_words.json');

function loadFrequencyData(): Map<string, number> {
  const hanziToRank = new Map<string, number>();
  if (fs.existsSync(freqPath)) {
    const data = fs.readFileSync(freqPath, 'utf-8');
    for (const line of data.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        hanziToRank.set(parts[2], parseInt(parts[0]));
      }
    }
  }
  return hanziToRank;
}

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function splitEnglish(text: string, delimiters: RegExp): string[] {
  const results: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (depth === 0) {
      const remaining = text.slice(i);
      const m = remaining.match(delimiters);
      if (m && m.index === 0) {
        results.push(current.trim());
        i += m[0].length - 1;
        current = '';
        continue;
      }
      current += ch;
    } else {
      current += ch;
    }
  }
  results.push(current.trim());
  return results.filter((s) => s.length > 0);
}

function depluralize(word: string): string {
  if (word.endsWith('ies') && word.length > 3) {
    return word.slice(0, -3) + 'y';
  }
  if (word.endsWith('shes') || word.endsWith('ches') || word.endsWith('xes') || word.endsWith('zes')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

function extractCategoryFromHeadline(headline: string): string {
  const match = headline.match(/HSK\s+[\d-]+\s+(.+)/);
  if (!match) return '';
  return depluralize(match[1].trim().toLowerCase());
}

function extractCategoryFromFilename(filename: string): string {
  // "HSK_Coffee_Vocabulary_List.html" -> "coffee"
  // "Careers.html" -> "careers"
  // "Shenfenguanxi.html" -> "shenfenguanxi"
  let name = filename.replace(/\.html$/, '');
  name = name.replace(/^HSK_/, '').replace(/_Vocabulary_List$/, '').replace(/_/g, ' ');
  return name.toLowerCase();
}

function parseHskLevel(levelStr: string): number | undefined {
  const match = levelStr.match(/^HSK\s*(\d+)$/);
  if (match) {
    return parseInt(match[1]);
  }
  return undefined;
}

interface WordEntry {
  hanzi: string;
  pinyin: string;
  english: string[];
  hskLevel?: number;
  categories: string[];
  frequencyRank: number;
}

const frequencyData = loadFrequencyData();
const wordMap = new Map<string, WordEntry>();

function addWord(
  hanzi: string,
  pinyin: string,
  english: string[],
  hskLevel: number | undefined,
  category: string
) {
  if (!hanzi || !/[\u4e00-\u9fff]/.test(hanzi)) return;

  const existing = wordMap.get(hanzi);
  if (existing) {
    // Same hanzi exists - only merge if pinyin matches (same reading)
    if (existing.pinyin === pinyin) {
      for (const eng of english) {
        const idx = existing.english.findIndex((e) => e.toLowerCase() === eng.toLowerCase());
        if (idx === -1) {
          existing.english.push(eng);
        } else if (eng[0] >= 'a' && eng[0] <= 'z' && !(existing.english[idx][0] >= 'a' && existing.english[idx][0] <= 'z')) {
          existing.english[idx] = eng;
        }
      }
      if (category && !existing.categories.includes(category)) {
        existing.categories.push(category);
      }
      // Keep lowest HSK level (if both defined)
      if (hskLevel !== undefined) {
        if (existing.hskLevel === undefined || hskLevel < existing.hskLevel) {
          existing.hskLevel = hskLevel;
        }
      }
    }
    // Different pinyin - ignore (keep first reading)
  } else {
    wordMap.set(hanzi, {
      hanzi,
      pinyin,
      english,
      hskLevel,
      categories: category ? [category] : [],
      frequencyRank: frequencyData.get(hanzi) ?? 999999,
    });
  }
}

// Parse the main hsk_words.html file (has h2 category headings)
function parseMainHskFile(htmlPath: string) {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);

  $('h2').each((_, h2) => {
    const headlineText = $(h2).find('.mw-headline').text();
    const category = extractCategoryFromHeadline(headlineText);
    if (!category) return;

    $(h2)
      .nextUntil('h2')
      .filter('table')
      .find('tr')
      .each((_, tr) => {
        const cells = $(tr).find('td');
        if (cells.length < 4) return;

        const hanzi = normalizeSpaces($(cells[0]).text().trim());
        const pinyin = normalizeSpaces($(cells[1]).text().trim());
        const english = splitEnglish(normalizeSpaces($(cells[2]).text().trim()), /^[,;]\s+/);
        const hskLevel = parseHskLevel(normalizeSpaces($(cells[3]).text().trim()));

        addWord(hanzi, pinyin, english, hskLevel, category);
      });
  });
}

// Parse labelled word files (category from filename, no h2 sections)
function parseLabelledFile(htmlPath: string, category: string) {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);

  $('tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 4) return;

    const hanzi = normalizeSpaces($(cells[0]).text().trim());
    if (!/[\u4e00-\u9fff]/.test(hanzi)) return;

    const pinyin = normalizeSpaces($(cells[1]).text().trim());
    const english = splitEnglish(normalizeSpaces($(cells[2]).text().trim()), /^[,;]\s+/);
    const hskLevel = parseHskLevel(normalizeSpaces($(cells[3]).text().trim()));

    addWord(hanzi, pinyin, english, hskLevel, category);
  });
}

function extractCategoryFromCommonWordsHeading(headline: string): string {
  let cat = headline
    .replace(/^(basic\s+)?(chinese\s+)?vocabulary\s+(for|of|about)\s+/i, '')
    .replace(/\s+(vocabulary\s+)?(in\s+chinese)$/i, '')
    .replace(/\s+words\s+in\s+chinese$/i, '')
    .trim();
  return depluralize(cat.toLowerCase());
}

// Parse 1000_common_words.html (h3 category headings, no HSK level column)
function parseCommonWordsFile(htmlPath: string) {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);

  $('h3.wp-block-heading').each((_, h3) => {
    const headlineText = $(h3).text();
    const category = extractCategoryFromCommonWordsHeading(headlineText);
    if (!category) return;

    $(h3)
      .nextUntil('h3')
      .find('table')
      .first()
      .find('tbody tr')
      .each((_, tr) => {
        const cells = $(tr).find('td');
        if (cells.length < 4) return;

        // Cell 0 is row number, cells 1-3 are hanzi, pinyin, english
        const hanzi = normalizeSpaces($(cells[1]).text().trim());
        const pinyin = normalizeSpaces($(cells[2]).text().trim());
        const english = splitEnglish(normalizeSpaces($(cells[3]).text().trim()), /^\/\s*/);

        addWord(hanzi, pinyin, english, undefined, category);
      });
  });
}

// Parse main HSK words file
console.log('Parsing hsk_words.html...');
parseMainHskFile(mainHtmlPath);
console.log(`  ${wordMap.size} words so far`);

// Parse 1000 common words file
if (fs.existsSync(commonWordsPath)) {
  const sizeBefore = wordMap.size;
  console.log('Parsing 1000_common_words.html...');
  parseCommonWordsFile(commonWordsPath);
  console.log(`  +${wordMap.size - sizeBefore} new words (${wordMap.size} total)`);
}

// Parse all labelled word files
if (fs.existsSync(labelledDir)) {
  const files = fs.readdirSync(labelledDir).filter((f) => f.endsWith('.html'));
  for (const file of files) {
    const category = extractCategoryFromFilename(file);
    const filePath = path.join(labelledDir, file);
    const sizeBefore = wordMap.size;
    parseLabelledFile(filePath, category);
    const newWords = wordMap.size - sizeBefore;
    console.log(`Parsing ${file} (${category}): +${newWords} new words`);
  }
}

// Convert to array and sort by frequency rank
const words = Array.from(wordMap.values()).sort((a, b) => a.frequencyRank - b.frequencyRank);

fs.writeFileSync(outputPath, JSON.stringify(words, null, 2));
console.log(`\nWrote ${words.length} words to ${outputPath}`);

// Stats
const withHsk = words.filter((w) => w.hskLevel !== undefined).length;
const withoutHsk = words.filter((w) => w.hskLevel === undefined).length;
console.log(`  ${withHsk} with HSK level, ${withoutHsk} without`);
