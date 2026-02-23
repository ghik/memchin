import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cedictPath = path.join(__dirname, '../../sources/cedict_1_0_ts_utf-8_mdbg.txt');
const freqPath = path.join(__dirname, '../../sources/internet-zh.num.txt');
const outputPath = path.join(__dirname, '../../sources/cedict_by_freq.txt');

// Load frequency data: word -> rank
const freqMap = new Map<string, number>();
for (const line of fs.readFileSync(freqPath, 'utf-8').split('\n')) {
  const parts = line.trim().split(/\s+/);
  if (parts.length >= 3) {
    freqMap.set(parts[2], parseInt(parts[0]));
  }
}

// Read CEDICT
const lines = fs.readFileSync(cedictPath, 'utf-8').split('\n');
const comments: string[] = [];
const entries: { line: string; simplified: string; index: number }[] = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith('#') || line.trim() === '') {
    comments.push(line);
  } else {
    // Format: Traditional Simplified [pinyin] /def1/def2/
    const match = line.match(/^\S+\s+(\S+)/);
    const simplified = match ? match[1] : '';
    entries.push({ line, simplified, index: i });
  }
}

// Sort: by frequency rank (ascending), then original order for unranked
entries.sort((a, b) => {
  const rankA = freqMap.get(a.simplified);
  const rankB = freqMap.get(b.simplified);
  if (rankA != null && rankB != null) return rankA - rankB;
  if (rankA != null) return -1;
  if (rankB != null) return 1;
  return a.index - b.index;
});

// Write output
const output = [...comments, ...entries.map((e) => e.line)].join('\n');
fs.writeFileSync(outputPath, output);

const ranked = entries.filter((e) => freqMap.has(e.simplified)).length;
console.log(`Wrote ${entries.length} entries (${ranked} ranked, ${entries.length - ranked} unranked) to ${outputPath}`);
