import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CharacterInfo } from '../../shared/types.js';
import { filterDefinitions, filterEntries, loadCedict } from './cedict.js';
import { stripTones } from '../../shared/pinyin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const idsPath = path.join(__dirname, '../../../sources/ids.txt');

// IDS operator characters (U+2FF0..U+2FFB) — describe spatial layout, not actual components
const IDS_OPERATORS = new Set('⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻');
const THREE_OPERAND_OPS = new Set('⿲⿳');
const LEFT_RIGHT_OPS = new Set('⿰⿲');

let idsMap: Map<string, string[]> | null = null;
let idsRawMap: Map<string, string> | null = null;

/**
 * Load and parse the IDS file.
 * Returns a map from character to its direct components (excluding IDS operators).
 */
export function loadIds(): Map<string, string[]> {
  if (idsMap) return idsMap;
  idsMap = new Map();
  idsRawMap = new Map();

  if (!fs.existsSync(idsPath)) return idsMap;

  const data = fs.readFileSync(idsPath, 'utf-8');
  for (const line of data.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;

    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const char = parts[1];

    // IDS entries may have multiple tab-separated variants with regional tags like [G], [TJK].
    // Prefer the variant tagged [G] (mainland China); fall back to the first entry.
    const idsCandidates = parts.slice(2);
    let ids = idsCandidates.find((s) => /\[.*G.*\]/.test(s)) ?? idsCandidates[0];

    // Strip the regional tag suffix (e.g. "[GJ]")
    ids = ids.replace(/\[.*\]$/, '');

    // Extract direct components: all characters in the IDS string that aren't operators
    const components: string[] = [];
    for (const ch of ids) {
      if (!IDS_OPERATORS.has(ch) && ch !== char) {
        components.push(ch);
      }
    }

    if (components.length > 0) {
      idsMap.set(char, components);
      idsRawMap.set(char, ids);
    }
  }

  return idsMap;
}

function loadIdsRaw(): Map<string, string> {
  loadIds();
  return idsRawMap!;
}

// ---------------------------------------------------------------------------
// IDS Tree & Character Similarity
// ---------------------------------------------------------------------------

interface IdsNode {
  char: string;
  operator: string | null;
  children: IdsNode[];
}

const PLACEHOLDER_RE = /[\u2460-\u2473]/; // ①–⑳

function parseIdsTree(char: string): IdsNode {
  const raw = loadIdsRaw().get(char);
  if (!raw) return { char, operator: null, children: [] };

  const symbols = [...raw];
  let pos = 0;

  function parse(): IdsNode {
    if (pos >= symbols.length) return { char: '?', operator: null, children: [] };
    const sym = symbols[pos++];
    if (IDS_OPERATORS.has(sym)) {
      const arity = THREE_OPERAND_OPS.has(sym) ? 3 : 2;
      const children: IdsNode[] = [];
      for (let i = 0; i < arity; i++) {
        children.push(parse());
      }
      return { char, operator: sym, children };
    }
    // Leaf — if it's a placeholder (②③…) treat it as opaque
    if (PLACEHOLDER_RE.test(sym)) {
      return { char: sym, operator: null, children: [] };
    }
    // Recursively decompose known characters
    return parseIdsTree(sym);
  }

  const node = parse();
  // If the root parsed into a single leaf identical to char, or contains placeholders
  // in all children, treat as leaf
  if (node.operator === null) return { char, operator: null, children: [] };
  if (
    node.children.length > 0 &&
    node.children.every((c) => PLACEHOLDER_RE.test(c.char))
  ) {
    return { char, operator: null, children: [] };
  }
  return node;
}

// -- Leaf similarity table --------------------------------------------------

const LEAF_SIMILARITY: Map<string, number> = new Map();

function addLeafSim(a: string, b: string, score: number) {
  LEAF_SIMILARITY.set(`${a}|${b}`, score);
  LEAF_SIMILARITY.set(`${b}|${a}`, score);
}

addLeafSim('土', '士', 0.9);
addLeafSim('未', '末', 0.9);
addLeafSim('己', '已', 0.8);
addLeafSim('己', '巳', 0.8);
addLeafSim('已', '巳', 0.8);
addLeafSim('千', '干', 0.8);
addLeafSim('千', '于', 0.8);
addLeafSim('干', '于', 0.8);
addLeafSim('人', '入', 0.75);
addLeafSim('人', '八', 0.75);
addLeafSim('入', '八', 0.75);
addLeafSim('王', '玉', 0.75);
addLeafSim('牛', '午', 0.75);
addLeafSim('刀', '力', 0.75);
addLeafSim('大', '犬', 0.75);
addLeafSim('日', '曰', 0.6);
addLeafSim('日', '目', 0.6);
addLeafSim('曰', '目', 0.6);
addLeafSim('氵', '冫', 0.7);
addLeafSim('丨', '亅', 0.8);

// -- Size tiers for weight calculation --------------------------------------

const TINY = new Set('丶㇀');
const SMALL = new Set('一丿丨乙亅㇏㇉亻讠氵忄犭纟钅饣礻衤扌刂卩阝宀冖艹⺮灬');
const CONTEXT_NARROW = new Set('女口土木日月火石目田王力又山');

function rawWeight(char: string, operator: string | null): number {
  if (TINY.has(char)) return 1;
  if (SMALL.has(char)) return 2;
  if (CONTEXT_NARROW.has(char) && operator !== null && LEFT_RIGHT_OPS.has(operator))
    return 2;
  return 5;
}

function computeWeights(
  children: IdsNode[],
  operator: string | null,
): number[] {
  const raw = children.map((c) => rawWeight(c.char, operator));
  const total = raw.reduce((a, b) => a + b, 0);
  return total > 0 ? raw.map((w) => w / total) : raw.map(() => 1 / children.length);
}

// -- Core similarity --------------------------------------------------------

const similarityCache = new Map<string, number>();

function similarity(a: IdsNode, b: IdsNode): number {
  // Rule 1: identical characters
  if (a.char === b.char) return 1.0;

  const key = `${a.char}|${b.char}`;
  const cached = similarityCache.get(key);
  if (cached !== undefined) return cached;

  // Prevent infinite recursion for cycles
  similarityCache.set(key, 0);

  const aLeaf = a.operator === null;
  const bLeaf = b.operator === null;

  // Rule 2: both leaves
  if (aLeaf && bLeaf) {
    const intrinsic = LEAF_SIMILARITY.get(key) ?? 0;
    similarityCache.set(key, intrinsic);
    return intrinsic;
  }

  let best = 0;

  // Strategy (a): same operator, pairwise comparison
  if (!aLeaf && !bLeaf && a.operator === b.operator && a.children.length === b.children.length) {
    const rawA = a.children.map((c) => rawWeight(c.char, a.operator));
    const rawB = b.children.map((c) => rawWeight(c.char, b.operator));
    const avgRaw = rawA.map((w, i) => (w + rawB[i]) / 2);
    const total = avgRaw.reduce((s, w) => s + w, 0);
    const weights = total > 0 ? avgRaw.map((w) => w / total) : avgRaw.map(() => 1 / avgRaw.length);
    let score = 0;
    for (let i = 0; i < a.children.length; i++) {
      score += similarity(a.children[i], b.children[i]) * weights[i];
    }
    best = Math.max(best, score);
  }

  // Strategy (b): different operators, best-match pairing with 0.5 penalty
  if (!aLeaf && !bLeaf && a.operator !== b.operator) {
    const score = bestMatchPairing(a, b) * 0.5;
    best = Math.max(best, score);
  }

  // Strategy (c): A is leaf/any, B is structured — fit A into B's children
  if (!bLeaf) {
    const score = fitIntoStructure(a, b);
    best = Math.max(best, score);
  }

  // Strategy (d): A is structured, B is leaf/any — fit B into A's children
  if (!aLeaf) {
    const score = fitIntoStructure(b, a);
    best = Math.max(best, score);
  }

  similarityCache.set(key, best);
  return best;
}

function bestMatchPairing(a: IdsNode, b: IdsNode): number {
  const longer = a.children.length >= b.children.length ? a : b;
  const shorter = a.children.length < b.children.length ? a : b;
  const padded = generateNullPaddings(shorter.children, longer.children.length);
  const wLonger = computeWeights(longer.children, longer.operator);

  let best = 0;
  for (const arrangement of padded) {
    let score = 0;
    for (let i = 0; i < longer.children.length; i++) {
      const item = arrangement[i];
      if (item === null) continue; // weight × 0
      score += similarity(item, longer.children[i]) * wLonger[i];
    }
    best = Math.max(best, score);
  }
  return best;
}

function fitIntoStructure(single: IdsNode, structured: IdsNode): number {
  const weights = computeWeights(structured.children, structured.operator);
  let best = 0;
  for (let pos = 0; pos < structured.children.length; pos++) {
    let score = 0;
    for (let i = 0; i < structured.children.length; i++) {
      if (i === pos) {
        score += similarity(single, structured.children[i]) * weights[i];
      }
      // else null in that position → 0 contribution
    }
    best = Math.max(best, score);
  }
  return best;
}

function generateNullPaddings(
  shorter: IdsNode[],
  targetLen: number,
): (IdsNode | null)[][] {
  const nullsNeeded = targetLen - shorter.length;
  if (nullsNeeded <= 0) return [shorter];

  // Generate all ways to insert `nullsNeeded` nulls into `shorter` to reach `targetLen`.
  // We choose positions (0..targetLen-1) for the shorter items; remaining slots get null.
  const results: (IdsNode | null)[][] = [];
  const positions: number[] = [];

  function choose(start: number, depth: number) {
    if (depth === shorter.length) {
      const arr: (IdsNode | null)[] = new Array(targetLen).fill(null);
      for (let i = 0; i < positions.length; i++) {
        arr[positions[i]] = shorter[i];
      }
      results.push(arr);
      return;
    }
    for (let i = start; i < targetLen - (shorter.length - depth - 1); i++) {
      positions[depth] = i;
      choose(i + 1, depth + 1);
    }
  }
  choose(0, 0);
  return results;
}

/**
 * Compute structural similarity between two Chinese characters (0–100).
 */
export function characterSimilarity(a: string, b: string): number {
  if (a === b) return 100;
  similarityCache.clear();
  const nodeA = parseIdsTree(a);
  const nodeB = parseIdsTree(b);
  return Math.round(similarity(nodeA, nodeB) * 100);
}

/**
 * Look up a single character in CEDICT, using an optional pinyin hint to disambiguate.
 * Priority: exact pinyin match > toneless match > first filtered entry > first entry.
 */
function lookupChar(char: string, pinyinHint?: string): CharacterInfo {
  const entries = loadCedict().get(char) || [];
  const filtered = filterEntries(entries);
  let matched = filtered.length > 0 ? filtered : entries;

  if (pinyinHint && filtered.length > 1) {
    const exact = filtered.filter((e) => e.pinyin === pinyinHint);
    if (exact.length > 0) {
      matched = exact;
    } else {
      const toneless = stripTones(pinyinHint);
      const approx = filtered.filter((e) => stripTones(e.pinyin) === toneless);
      if (approx.length > 0) {
        matched = approx;
      }
    }
  }

  const entry = matched[0];
  if (!entry) {
    return { hanzi: char, pinyin: '', meaning: [], components: [] };
  }
  const meaning = filterDefinitions(entry.definitions);

  // Collect other readings from the same pool that was used to pick `entry`.
  // Dedupe by (pinyin, meaning) to collapse identical CEDICT duplicates and exclude the chosen one.
  const pool = filtered.length > 0 ? filtered : entries;
  const seen = new Set<string>([`${entry.pinyin}|${meaning.join('|')}`]);
  const alternates: { pinyin: string; meaning: string[] }[] = [];
  for (const e of pool) {
    if (e === entry) {
      continue;
    }
    const m = filterDefinitions(e.definitions);
    const key = `${e.pinyin}|${m.join('|')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    alternates.push({ pinyin: e.pinyin, meaning: m });
  }

  return {
    hanzi: char,
    traditional: entry.traditional !== char ? entry.traditional : undefined,
    pinyin: entry.pinyin,
    meaning,
    components: [],
    alternates: alternates.length > 0 ? alternates : undefined,
  };
}

/**
 * Recursively decompose a character into IDS sub-components.
 */
function decomposeChar(char: string, pinyinHint?: string): CharacterInfo {
  const breakdown = lookupChar(char, pinyinHint);
  const idsComponents = loadIds().get(char);
  if (idsComponents) {
    breakdown.components = idsComponents.map((comp) => decomposeChar(comp));
  }
  return breakdown;
}

/**
 * Decompose a word or character into its parts with meanings, recursively.
 * - Multi-char word: splits into individual characters (with pinyin disambiguation),
 *   each recursively decomposed into IDS sub-components
 * - Single character: recursively splits into IDS sub-components
 */
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf]/;

export function decomposeWord(hanzi: string, wordPinyin?: string): CharacterInfo[] {
  const syllables = wordPinyin ? wordPinyin.split(/\s+/) : [];
  const chars = [...hanzi];
  const result: CharacterInfo[] = [];
  let syllableIdx = 0;
  for (const char of chars) {
    if (CJK_REGEX.test(char)) {
      result.push(decomposeChar(char, syllables[syllableIdx]));
    }
    syllableIdx++;
  }
  return result;
}
