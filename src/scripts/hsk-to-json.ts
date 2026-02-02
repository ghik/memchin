import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainHtmlPath = path.join(__dirname, '../../hsk_words.html');
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

function extractCategoryFromHeadline(headline: string): string {
  const match = headline.match(/HSK\s+[\d-]+\s+(.+)/);
  if (!match) return '';
  let category = match[1].trim();
  if (category.endsWith('s')) {
    category = category.slice(0, -1);
  }
  return category.toLowerCase();
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
        if (!existing.english.includes(eng)) {
          existing.english.push(eng);
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
  const sections = html.split(/<h2>/);

  for (const section of sections) {
    const headlineMatch = section.match(/class="mw-headline"[^>]*>(?:<a[^>]*>)?([^<]+)/);
    if (!headlineMatch) continue;
    const category = extractCategoryFromHeadline(headlineMatch[1]);
    if (!category) continue;

    const rowRegex =
      /<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g;
    let match;
    while ((match = rowRegex.exec(section)) !== null) {
      const hanzi = decodeHtmlEntities(match[1].trim());
      const pinyin = decodeHtmlEntities(match[2].trim());
      const english = decodeHtmlEntities(match[3].trim())
        .split(/[,;]\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const hskLevel = parseHskLevel(decodeHtmlEntities(match[4].trim()));

      addWord(hanzi, pinyin, english, hskLevel, category);
    }
  }
}

// Parse labelled word files (category from filename, no h2 sections)
function parseLabelledFile(htmlPath: string, category: string) {
  const html = fs.readFileSync(htmlPath, 'utf-8');

  const rowRegex =
    /<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const hanzi = decodeHtmlEntities(match[1].trim());
    const pinyin = decodeHtmlEntities(match[2].trim());
    const english = decodeHtmlEntities(match[3].trim())
      .split(/[,;]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const hskLevel = parseHskLevel(decodeHtmlEntities(match[4].trim()));

    addWord(hanzi, pinyin, english, hskLevel, category);
  }
}

// Parse main HSK words file
console.log('Parsing hsk_words.html...');
parseMainHskFile(mainHtmlPath);
console.log(`  ${wordMap.size} words so far`);

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
