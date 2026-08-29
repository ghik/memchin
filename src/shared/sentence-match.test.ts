import { describe, it, expect } from 'vitest';
import { normalizeSentence, usesWord } from './sentence-match.js';

describe('normalizeSentence', () => {
  /** The comparison it exists for: two sentences that say the same thing the same way */
  const same = (a: string, b: string) => normalizeSentence(a) === normalizeSentence(b);

  it('keeps hanzi, which are letters', () => {
    expect(normalizeSentence('我今天很忙。')).toBe('我今天很忙');
  });

  it('ignores a full stop the learner was never shown', () => {
    expect(same('这是我的猫', '这是我的猫。')).toBe(true);
    expect(same('你吃了吗', '你吃了吗？')).toBe(true);
  });

  it('ignores punctuation inside the sentence', () => {
    expect(same('下雨了于是我们取消了活动', '下雨了，于是我们取消了活动')).toBe(true);
    expect(same('我买了苹果香蕉和梨', '我买了苹果、香蕉和梨')).toBe(true);
  });

  it('ignores spacing anywhere', () => {
    expect(same(' 这是 我的猫 ', '这是我的猫。')).toBe(true);
  });

  it('folds fullwidth forms onto their ASCII counterparts', () => {
    expect(same('ＡＢ１２', 'AB12')).toBe(true);
  });

  it('folds latin case', () => {
    expect(same('OK', 'ok')).toBe(true);
  });

  it('still tells apart a character that is genuinely different', () => {
    expect(same('这是你的猫', '这是我的猫。')).toBe(false);
  });

  it('keeps traditional apart from simplified, for the grader to comment on', () => {
    expect(same('這是我的貓', '这是我的猫')).toBe(false);
  });

  it('leaves nothing of a sentence that was only punctuation', () => {
    expect(normalizeSentence('。！')).toBe('');
    expect(normalizeSentence('')).toBe('');
  });
});

describe('usesWord', () => {
  it('finds the word wherever it sits in the sentence', () => {
    expect(usesWord('他还在学习', '还')).toBe(true);
    expect(usesWord('我们一起去', '一起')).toBe(true);
    expect(usesWord('起来吧', '起来')).toBe(true);
  });

  it('sees through punctuation the learner may have typed', () => {
    expect(usesWord('他还在学习。', '还')).toBe(true);
  });

  it('turns down a sentence that says the same thing without the word', () => {
    expect(usesWord('他七点起床', '起来')).toBe(false);
    expect(usesWord('现在是三点', '时')).toBe(false);
  });

  it('never passes on an empty answer or an empty word', () => {
    expect(usesWord('', '还')).toBe(false);
    expect(usesWord('他还在学习', '')).toBe(false);
  });
});
