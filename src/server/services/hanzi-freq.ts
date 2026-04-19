import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { numberedToToneMarked } from '../../shared/pinyin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hanziFreqPath = path.join(__dirname, '../../../sources/hanzi_frequency.html');
const wordFreqPath = path.join(__dirname, '../../../sources/internet-zh.num.txt');

let wordFreqMap: Map<string, number> | null = null;

export function loadWordFrequencyData(): Map<string, number> {
  if (wordFreqMap) {
    return wordFreqMap;
  }
  wordFreqMap = new Map();
  if (fs.existsSync(wordFreqPath)) {
    const data = fs.readFileSync(wordFreqPath, 'utf-8');
    for (const line of data.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        wordFreqMap.set(parts[2], parseInt(parts[0]));
      }
    }
  }
  return wordFreqMap;
}

export interface HanziCharInfo {
  pinyin: string;
  english: string[];
  rank: number;
}

export function splitEnglish(text: string, delimiters: RegExp): string[] {
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

export function parseHanziFrequencyFile(htmlPath: string): Map<string, HanziCharInfo> {
  const data = new Map<string, HanziCharInfo>();
  const buf = fs.readFileSync(htmlPath);
  const html = new TextDecoder('gbk').decode(buf);
  const $ = cheerio.load(html);
  $('pre').find('br').replaceWith('\n');
  const preText = $('pre').text();
  const lines = preText.split('\n');

  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 6) {
      continue;
    }

    const rank = parseInt(cols[0]);
    if (isNaN(rank)) {
      continue;
    }

    const hanzi = cols[1].trim();
    if (!hanzi || !/[\u4e00-\u9fff]/.test(hanzi)) {
      continue;
    }

    let rawPinyin = cols[4].trim();
    if (rawPinyin.includes('/')) {
      rawPinyin = rawPinyin.split('/')[0];
    }
    const pinyin = numberedToToneMarked(rawPinyin);

    const rawEnglish = cols[5].trim();
    const commaGroups = splitEnglish(rawEnglish, /^,\s*/);
    const firstGroup = commaGroups[0] || '';
    const translations = firstGroup
      .split(/[\/;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const english: string[] = [];
    for (const t of translations) {
      if (t === '(surname)') {
        continue;
      }
      const wcMatch = t.match(/^\((\w+)\)\s+(.+)$/);
      if (wcMatch) {
        english.push(wcMatch[2]);
      } else {
        english.push(t);
      }
    }

    if (english.length === 0) {
      continue;
    }

    data.set(hanzi, { pinyin, english, rank });
  }

  return data;
}

let charData: Map<string, HanziCharInfo> | null = null;

export function lookupChar(char: string): HanziCharInfo | undefined {
  if (!charData) {
    charData = parseHanziFrequencyFile(hanziFreqPath);
  }
  return charData.get(char);
}
