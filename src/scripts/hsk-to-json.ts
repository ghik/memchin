import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, '../../hsk_words.html');
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

function extractCategory(headline: string): string {
  const match = headline.match(/HSK\s+[\d-]+\s+(.+)/);
  if (!match) return '';
  let category = match[1].trim();
  // Depluralize
  if (category.endsWith('s')) {
    category = category.slice(0, -1);
  }
  return category;
}

interface WordEntry {
  hanzi: string;
  pinyin: string;
  english: string[];
  hskLevel: number;
  categories: string[];
  frequencyRank: number;
}

const html = fs.readFileSync(htmlPath, 'utf-8');
const frequencyData = loadFrequencyData();

// Map from hanzi to word entry (first pinyin reading wins)
const wordMap = new Map<string, WordEntry>();

// Split by h2 headings to get category sections
const sections = html.split(/<h2>/);

for (const section of sections) {
  const headlineMatch = section.match(/class="mw-headline"[^>]*>(?:<a[^>]*>)?([^<]+)/);
  if (!headlineMatch) continue;
  const category = extractCategory(headlineMatch[1]);
  if (!category) continue;

  const rowRegex =
    /<tr>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g;
  let match;
  while ((match = rowRegex.exec(section)) !== null) {
    const hanzi = decodeHtmlEntities(match[1].trim());
    const pinyin = decodeHtmlEntities(match[2].trim());
    const english = decodeHtmlEntities(match[3].trim()).split(/;\s+/);
    const hskLevel = parseInt(decodeHtmlEntities(match[4].trim()).replace(/^HSK\s*/, ''));

    if (!hanzi || !/[\u4e00-\u9fff]/.test(hanzi)) continue;

    const existing = wordMap.get(hanzi);
    if (existing) {
      // Same hanzi exists - only merge if pinyin matches (same reading)
      if (existing.pinyin === pinyin) {
        // Add english if not already present
        for (const eng in english) {
          if (!existing.english.includes(eng)) {
            existing.english.push(eng);
          }
        }
        // Add category if not already present
        if (!existing.categories.includes(category)) {
          existing.categories.push(category);
        }
        // Keep lowest HSK level
        if (hskLevel < existing.hskLevel) {
          existing.hskLevel = hskLevel;
        }
      }
      // Different pinyin - ignore (keep first reading)
    } else {
      // New word
      wordMap.set(hanzi, {
        hanzi,
        pinyin,
        english: english,
        hskLevel,
        categories: [category],
        frequencyRank: frequencyData.get(hanzi) ?? 999999,
      });
    }
  }
}

// Convert to array and sort by frequency rank
const words = Array.from(wordMap.values()).sort((a, b) => a.frequencyRank - b.frequencyRank);

fs.writeFileSync(outputPath, JSON.stringify(words, null, 2));
console.log(`Wrote ${words.length} words to ${outputPath}`);
