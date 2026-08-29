import { describe, it, expect } from 'vitest';
import { normalizeSentence, sentenceMatches, usesWord } from './sentence-match.js';

describe('sentenceMatches', () => {
  it('ignores a full stop the learner was never shown', () => {
    expect(sentenceMatches('这是我的猫', '这是我的猫。')).toBe(true);
    expect(sentenceMatches('你吃了吗', '你吃了吗？')).toBe(true);
  });

  it('ignores punctuation inside the sentence', () => {
    expect(sentenceMatches('下雨了于是我们取消了活动', '下雨了，于是我们取消了活动')).toBe(true);
    expect(sentenceMatches('我买了苹果香蕉和梨', '我买了苹果、香蕉和梨')).toBe(true);
  });

  it('ignores spacing anywhere', () => {
    expect(sentenceMatches(' 这是 我的猫 ', '这是我的猫。')).toBe(true);
  });

  it('folds fullwidth forms onto their ASCII counterparts', () => {
    expect(sentenceMatches('ＡＢ１２', 'AB12')).toBe(true);
  });

  it('folds latin case', () => {
    expect(sentenceMatches('OK', 'ok')).toBe(true);
  });

  it('still fails on a character that is genuinely different', () => {
    expect(sentenceMatches('这是你的猫', '这是我的猫。')).toBe(false);
  });

  it('keeps traditional apart from simplified, for the grader to comment on', () => {
    expect(sentenceMatches('這是我的貓', '这是我的猫')).toBe(false);
  });

  it('never matches on an empty or punctuation-only answer', () => {
    expect(sentenceMatches('', '这是我的猫')).toBe(false);
    expect(sentenceMatches('。', '这是我的猫。')).toBe(false);
    // Guards the route's short circuit: two empties must not grade as correct
    expect(sentenceMatches('', '')).toBe(false);
    expect(sentenceMatches('。！', '，')).toBe(false);
  });
});

describe('normalizeSentence', () => {
  it('keeps hanzi, which are letters', () => {
    expect(normalizeSentence('我今天很忙。')).toBe('我今天很忙');
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
