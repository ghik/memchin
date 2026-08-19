import { describe, it, expect } from 'vitest';
import { notesAreAboutAHomophone } from './homophones.js';

describe('notesAreAboutAHomophone', () => {
  it('rejects notes that talk about a character sounding like the input', () => {
    expect(notesAreAboutAHomophone('章', '常用于 一张纸、五张桌子，作为量词使用。')).toBe(true);
    expect(notesAreAboutAHomophone('是', '常见于 事情、没事，表示事务。')).toBe(true);
  });

  it('accepts notes that cite near-synonyms, which are worth telling the learner', () => {
    expect(
      notesAreAboutAHomophone(
        '乳房',
        'A standard anatomical term for the breast. In casual conversation many speakers prefer 胸 or 奶子 depending on register.'
      )
    ).toBe(false);
  });

  it('accepts notes that use the input itself', () => {
    expect(notesAreAboutAHomophone('分享', 'Common in 分享经验, 分享照片.')).toBe(false);
  });

  it('accepts notes with no Chinese in them', () => {
    expect(notesAreAboutAHomophone('电脑', 'A very common noun for a computer.')).toBe(false);
  });
});
