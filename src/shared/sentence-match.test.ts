import { describe, it, expect } from 'vitest';
import { normalizeSentence, sentenceMatches } from './sentence-match.js';

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
