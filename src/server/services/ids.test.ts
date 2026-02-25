import { describe, it, expect } from 'vitest';
import { characterSimilarity } from './ids.js';

describe('characterSimilarity', () => {
  // ------------------------------------------------------------------
  // Rule 1: identical characters → 100
  // ------------------------------------------------------------------
  it('returns 100 for identical characters', () => {
    expect(characterSimilarity('山', '山')).toBe(100);
    expect(characterSimilarity('请', '请')).toBe(100);
  });

  // ------------------------------------------------------------------
  // Rule 2: both leaves, no decomposition
  // ------------------------------------------------------------------
  it('returns 0 for unrelated leaves', () => {
    expect(characterSimilarity('山', '水')).toBe(0);
  });

  // ------------------------------------------------------------------
  // Strategy (a): same operator, pairwise positional comparison
  // ------------------------------------------------------------------
  describe('same operator pairwise (strategy a)', () => {
    // ⿰讠青 vs ⿰氵青 — shared right component 青, small left radicals
    // avg raw weights [2, 5] → [2/7, 5/7]; 0×2/7 + 1×5/7 = 71%
    it('请 vs 清: shared 青, different small radicals', () => {
      expect(characterSimilarity('请', '清')).toBe(71);
    });

    // ⿰女马 vs ⿰口马 — context-narrow left in ⿰, normal right
    it('妈 vs 吗: shared 马, different context-narrow radicals', () => {
      expect(characterSimilarity('妈', '吗')).toBe(71);
    });

    // ⿰亻也 vs ⿰女也 — small 亻 vs context-narrow 女 (both weight 2 in ⿰)
    it('他 vs 她: shared 也, small vs context-narrow left', () => {
      expect(characterSimilarity('他', '她')).toBe(71);
    });

    // ⿰日月 vs ⿰月月 — both context-narrow in ⿰ (weight 2 each)
    // avg [2, 2] → [0.5, 0.5]; 0 + 0.5 = 50%
    it('明 vs 朋: equal-weight children, one shared', () => {
      expect(characterSimilarity('明', '朋')).toBe(50);
    });

    // ⿰氵也 vs ⿰马也 — 氵 is small(2), 马 is normal(5)
    // avg raw [(2+5)/2, 5] = [3.5, 5] → [7/17, 10/17]; 0 + 10/17 ≈ 59%
    it('池 vs 驰: asymmetric left weights (small vs normal)', () => {
      expect(characterSimilarity('池', '驰')).toBe(59);
    });

    // ⿱艹化 vs ⿱艹早 — shared small 艹, unrelated normal children
    // avg [2, 5] → [2/7, 5/7]; 1×2/7 + 0 = 29%
    it('花 vs 草: shared small radical, different normal parts', () => {
      expect(characterSimilarity('花', '草')).toBe(29);
    });

    // ⿰犭苗 vs ⿰犭句 — same pattern as above with 犭
    it('猫 vs 狗: shared small radical 犭', () => {
      expect(characterSimilarity('猫', '狗')).toBe(29);
    });

    // ⿰亻木 vs ⿰亻本 — 本 is leaf (no decomposition), 木 is leaf
    // 亻(2), 木 context-narrow in ⿰(2), 本 normal(5)
    // avg raw [(2+2)/2, (2+5)/2] = [2, 3.5] → [4/11, 7/11]; 1×4/11 + 0 = 36%
    it('休 vs 体: weight asymmetry from context-narrow vs normal', () => {
      expect(characterSimilarity('休', '体')).toBe(36);
    });

    // ⿱木口 vs ⿱口木 — same op ⿱ but children are swapped
    // pairwise sim(木,口)=0, sim(口,木)=0 → strategy (a) = 0; falls to (c)/(d)
    it('杏 vs 呆: same op, swapped children', () => {
      expect(characterSimilarity('杏', '呆')).toBe(25);
    });

    // ⿲王②王 vs ⿲王文王 — 3-operand operator
    // 王 context-narrow in ⿲(2), ②/文 normal(5)
    // avg [2, 5, 2] → [2/9, 5/9, 2/9]; 1×2/9 + 0 + 1×2/9 = 4/9 = 44%
    it('班 vs 斑: three-operand operator ⿲', () => {
      expect(characterSimilarity('班', '斑')).toBe(44);
    });
  });

  // ------------------------------------------------------------------
  // Strategy (a) with nested recursive similarity
  // ------------------------------------------------------------------
  describe('nested recursive similarity', () => {
    // 树=⿰木对, 村=⿰木寸. Same ⿰. sim(木,木)=1.
    // sim(对,寸): 对=⿰又寸 → fit 寸 at pos 1 → weight 5/7 → sim = 5/7
    // avg raw [2, 5] → [2/7, 5/7]; 1×2/7 + 5/7×5/7 = 2/7 + 25/49 = 39/49 ≈ 80%
    it('树 vs 村: child similarity recurses into 对(⿰又寸) vs 寸', () => {
      expect(characterSimilarity('树', '村')).toBe(80);
    });

    // 想=⿱相心, 思=⿱田心. sim(相,田): 相=⿰木目, 田 is leaf →
    // fit 田 into ⿰(木,目): sim(田,木)=0, sim(田,目)=0 → 0
    // avg [5, 5] → [0.5, 0.5]; 0 + 0.5 = 50%
    it('想 vs 思: recursive comparison yields no match for 相 vs 田', () => {
      expect(characterSimilarity('想', '思')).toBe(50);
    });
  });

  // ------------------------------------------------------------------
  // Strategy (b): different operators, best-match pairing with 0.5 penalty
  // ------------------------------------------------------------------
  describe('different operators (strategy b)', () => {
    // 困=⿴囗木 vs 休=⿰亻木. Different ops.
    // (b): identity pairing: sim(囗,亻)=0, sim(木,木)=1. weights [0.5, 0.5].
    //       0.5 × (0 + 0.5) = 0.25 → ties with (c)/(d) at 25%
    it('困 vs 休: different ops, shared 木 in matching position', () => {
      expect(characterSimilarity('困', '休')).toBe(25);
    });

    // 囚=⿴囗人 vs 从=⿰人人. Different ops.
    // (b): identity: sim(囗,人)=0, sim(人,人)=1. 0.5 × 0.5 = 0.25
    it('囚 vs 从: different ops, one shared child', () => {
      expect(characterSimilarity('囚', '从')).toBe(25);
    });
  });

  // ------------------------------------------------------------------
  // Strategy (c)/(d): fitting a character into the other's structure
  // ------------------------------------------------------------------
  describe('fitting into structure (strategy c/d)', () => {
    // 大(leaf) vs 太(⿵大丶). Strategy (c): place 大 at pos 0 of ⿵(大,丶)
    // weights [5/6, 1/6]; 1×5/6 + 0 = 83%
    it('大 vs 太: leaf fits dominant child position', () => {
      expect(characterSimilarity('大', '太')).toBe(83);
    });

    // 一(leaf, small) vs 二(⿱一一). Fit 一 into either child → 0.5
    // weights [0.5, 0.5]; 1×0.5 = 50%
    it('一 vs 二: leaf matches one of two equal children', () => {
      expect(characterSimilarity('一', '二')).toBe(50);
    });

    // 口(leaf) vs 回(⿴囗口). 口 and 囗 are different codepoints.
    // pos 0: sim(口,囗)=0. pos 1: sim(口,口)=1×0.5 = 50%
    it('口 vs 回: leaf matches inner but not outer component', () => {
      expect(characterSimilarity('口', '回')).toBe(50);
    });

    // 人(leaf) vs 从(⿰人人). Fit 人 into either position → 1×0.5 = 50%
    it('人 vs 从: leaf matches either child of doubled structure', () => {
      expect(characterSimilarity('人', '从')).toBe(50);
    });

    // 忘(⿱亡心) vs 忙(⿰忄亡). Different ops.
    // (d): fit 忙 into 忘's children. sim(忙,亡): 忙=⿰(忄,亡),
    //   fit 亡 into pos 1 → weight 5/7 → sim = 5/7.
    //   0.5 × 5/7 = 5/14 ≈ 36%
    it('忘 vs 忙: structured fits as child of other structure', () => {
      expect(characterSimilarity('忘', '忙')).toBe(36);
    });
  });

  // ------------------------------------------------------------------
  // Symmetry: similarity(a,b) === similarity(b,a)
  // ------------------------------------------------------------------
  describe('symmetry', () => {
    const pairs: [string, string][] = [
      ['请', '清'],
      ['大', '太'],
      ['杏', '呆'],
      ['忘', '忙'],
      ['困', '休'],
      ['树', '村'],
      ['池', '驰'],
    ];
    for (const [a, b] of pairs) {
      it(`${a}/${b} is symmetric`, () => {
        expect(characterSimilarity(a, b)).toBe(characterSimilarity(b, a));
      });
    }
  });

  // ------------------------------------------------------------------
  // Edge cases
  // ------------------------------------------------------------------
  describe('edge cases', () => {
    it('returns 0 for completely unrelated structured characters', () => {
      // ⿲王②王 vs ⿰日月 — different ops, different arities, no shared components
      expect(characterSimilarity('班', '明')).toBe(0);
    });

    it('returns 0 for unrelated leaf vs structured', () => {
      // 请=⿰讠青, 马 is leaf — 马 matches no component of 请
      expect(characterSimilarity('请', '马')).toBe(0);
    });

    it('returns 0 for unrelated structured pair with same op', () => {
      // ⿰亻白 vs ⿰氵也 — same ⿰ but all four leaves differ
      expect(characterSimilarity('伯', '池')).toBe(0);
    });
  });
});
