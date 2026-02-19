import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { numberedToToneMarked } from '../server/services/pinyin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcesDir = path.join(__dirname, '../../sources');
const mainHtmlPath = path.join(sourcesDir, 'hsk_words.html');
const commonWordsPath = path.join(sourcesDir, '1000_common_words.html');
const labelledDir = path.join(sourcesDir, 'hsk_labelled_words');
const freqPath = path.join(sourcesDir, 'internet-zh.num.txt');
const hanziFreqPath = path.join(sourcesDir, 'hanzi_frequency.html');
const bodyPath = path.join(sourcesDir, 'body.txt');
const familyPath = path.join(sourcesDir, 'family.html');
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

function parseLevelCategory(levelStr: string): string | undefined {
  const match = levelStr.match(/^([AB][12])$/i);
  if (match) {
    return match[1].toLowerCase();
  }
  return undefined;
}

interface WordEntry {
  hanzi: string;
  pinyin: string;
  english: string[];
  hskLevel?: number;
  categories: string[];
  wordFrequencyRank?: number;
  hanziFrequencyRank?: number;
}

const frequencyData = loadFrequencyData();
const wordMap = new Map<string, WordEntry>();

function splitSlashes(translations: string[]): string[] {
  return translations.flatMap((t) => splitEnglish(t, /^\//));
}

function addWord(
  hanzi: string,
  pinyin: string,
  english: string[],
  hskLevel: number | undefined,
  category: string,
  levelCategory?: string
) {
  if (!hanzi || !/[\u4e00-\u9fff]/.test(hanzi)) return;
  hanzi = hanzi.split('/')[0].trim();
  english = splitSlashes(english);

  const existing = wordMap.get(hanzi);
  if (existing) {
    // Same hanzi exists - only merge if pinyin matches (same reading)
    // Compare ignoring spaces/apostrophes since sources format pinyin differently
    const normPinyin = (s: string) => s.replace(/[\s']/g, '').toLowerCase();
    if (normPinyin(existing.pinyin) === normPinyin(pinyin)) {
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
      if (levelCategory && !existing.categories.includes(levelCategory)) {
        existing.categories.push(levelCategory);
      }
      // Keep lowest HSK level (if both defined)
      if (hskLevel !== undefined) {
        if (existing.hskLevel === undefined || hskLevel < existing.hskLevel) {
          existing.hskLevel = hskLevel;
        }
        const hskCategory = `hsk${hskLevel}`;
        if (!existing.categories.includes(hskCategory)) {
          existing.categories.push(hskCategory);
        }
      }
    }
    // Different pinyin - ignore (keep first reading)
  } else {
    const categories = category ? [category] : [];
    if (hskLevel !== undefined) {
      categories.push(`hsk${hskLevel}`);
    }
    if (levelCategory) {
      categories.push(levelCategory);
    }
    const wordFreqRank = frequencyData.get(hanzi);
    wordMap.set(hanzi, {
      hanzi,
      pinyin,
      english,
      hskLevel,
      categories,
      wordFrequencyRank: wordFreqRank,
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
    const levelStr = normalizeSpaces($(cells[3]).text().trim());
    const hskLevel = parseHskLevel(levelStr);
    const levelCategory = parseLevelCategory(levelStr);

    addWord(hanzi, pinyin, english, hskLevel, category, levelCategory);
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

// Parse hanzi_frequency.html for character-level frequency data
function parseHanziFrequencyFile(htmlPath: string) {
  const buf = fs.readFileSync(htmlPath);
  const html = new TextDecoder('gbk').decode(buf);
  const $ = cheerio.load(html);
  $('pre').find('br').replaceWith('\n');
  const preText = $('pre').text();
  const lines = preText.split('\n');

  let count = 0;
  for (const line of lines) {
    if (count >= 1000) break;
    const cols = line.split('\t');
    if (cols.length < 6) continue;

    const rank = parseInt(cols[0]);
    if (isNaN(rank)) continue;

    const hanzi = cols[1].trim();
    if (!hanzi || !/[\u4e00-\u9fff]/.test(hanzi)) continue;

    // Parse pinyin: take first reading if multiple separated by /
    let rawPinyin = cols[4].trim();
    if (rawPinyin.includes('/')) {
      rawPinyin = rawPinyin.split('/')[0];
    }
    const pinyin = numberedToToneMarked(rawPinyin);

    // Parse english
    const rawEnglish = cols[5].trim();
    // Split by comma (respecting parens/brackets), take first group
    const commaGroups = splitEnglish(rawEnglish, /^,\s*/);
    const firstGroup = commaGroups[0] || '';
    // Split by / and ; to get individual translations
    const translations = firstGroup.split(/[\/;]/).map((s) => s.trim()).filter((s) => s.length > 0);

    // Filter out "(surname)" entries and extract word-class categories
    const english: string[] = [];
    const categories: string[] = [];
    for (const t of translations) {
      if (t === '(surname)') continue;
      // Check for leading word-class indicator like "(n) ", "(v) ", "(adj) "
      const wcMatch = t.match(/^\((\w+)\)\s+(.+)$/);
      if (wcMatch) {
        const wc = wcMatch[1].toLowerCase();
        if (!categories.includes(wc)) categories.push(wc);
        english.push(wcMatch[2]);
      } else {
        english.push(t);
      }
    }

    if (english.length === 0) continue;

    const existing = wordMap.get(hanzi);
    if (existing) {
      // Already in word list - just set hanzi frequency rank
      existing.hanziFrequencyRank = rank;
    } else {
      // New character entry
      addWord(hanzi, pinyin, english, undefined, '');
      const entry = wordMap.get(hanzi);
      if (entry) {
        entry.hanziFrequencyRank = rank;
      }
    }

    count++;
  }
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

// Parse body.txt — format: 汉字 (pīnyīn) - english
function parseSimpleWordList(filePath: string, category: string) {
  const data = fs.readFileSync(filePath, 'utf-8');
  for (const line of data.split('\n')) {
    const match = line.match(/^(.+?)\s*\((.+?)\)\s*-\s*(.+)$/);
    if (!match) continue;
    const hanzi = match[1].trim();
    const pinyin = match[2].trim();
    const english = splitSlashes(splitEnglish(match[3].trim(), /^[,;]\s*/));
    addWord(hanzi, pinyin, english, undefined, category);
  }
}

if (fs.existsSync(bodyPath)) {
  const sizeBefore = wordMap.size;
  console.log('Parsing body.txt...');
  parseSimpleWordList(bodyPath, 'body');
  console.log(`  +${wordMap.size - sizeBefore} new words (${wordMap.size} total)`);
}

// Parse family.html — tables with 3 columns plus list items in "汉字 (pīnyīn) — English" format
function parseFamilyHtml(htmlPath: string, category: string) {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);

  // Parse list items: 汉字 (pīnyīn) — English
  $('li').each((_, li) => {
    const text = normalizeSpaces($(li).text().trim());
    const match = text.match(/^(.+?)\s*\((.+?)\)\s*[—–-]\s*(.+)$/);
    if (!match) return;
    const hanzi = match[1].trim();
    if (!/[\u4e00-\u9fff]/.test(hanzi)) return;
    const pinyin = match[2].trim();
    const english = splitEnglish(match[3].trim(), /^[,;]\s+/);
    addWord(hanzi, pinyin, english, undefined, category);
  });

  // Parse tables
  $('table').each((_, table) => {
    $(table).find('tr').each((_, tr) => {
      const cells = $(tr).find('td');
      if (cells.length < 3) return;

      const hanzi = normalizeSpaces($(cells[0]).text().trim());
      if (!/[\u4e00-\u9fff]/.test(hanzi)) return;

      const pinyin = normalizeSpaces($(cells[1]).text().trim());
      const english = splitEnglish(normalizeSpaces($(cells[2]).text().trim()), /^[,;]\s+/);

      addWord(hanzi, pinyin, english, undefined, category);
    });
  });
}

if (fs.existsSync(familyPath)) {
  const sizeBefore = wordMap.size;
  console.log('Parsing family.html...');
  parseFamilyHtml(familyPath, 'family');
  console.log(`  +${wordMap.size - sizeBefore} new words (${wordMap.size} total)`);
}

// Parse hanzi frequency file
if (fs.existsSync(hanziFreqPath)) {
  const sizeBefore = wordMap.size;
  console.log('Parsing hanzi_frequency.html...');
  parseHanziFrequencyFile(hanziFreqPath);
  console.log(`  +${wordMap.size - sizeBefore} new characters (${wordMap.size} total)`);
}

// Convert to array and sort by frequency rank
const words = Array.from(wordMap.values()).sort((a, b) =>
  (a.wordFrequencyRank ?? a.hanziFrequencyRank ?? 999999) - (b.wordFrequencyRank ?? b.hanziFrequencyRank ?? 999999)
);

fs.writeFileSync(outputPath, JSON.stringify(words, null, 2));
console.log(`\nWrote ${words.length} words to ${outputPath}`);

// Stats
const withHsk = words.filter((w) => w.hskLevel !== undefined).length;
const withoutHsk = words.filter((w) => w.hskLevel === undefined).length;
const withHanziRank = words.filter((w) => w.hanziFrequencyRank !== undefined).length;
const withWordRank = words.filter((w) => w.wordFrequencyRank !== undefined).length;
console.log(`  ${withHsk} with HSK level, ${withoutHsk} without`);
console.log(`  ${withWordRank} with word frequency rank, ${withHanziRank} with hanzi frequency rank`);
