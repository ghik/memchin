import { describe, it, expect } from 'vitest';
import { toNumberedPinyin } from './pinyin.js';

describe('toNumberedPinyin', () => {
  it('converts single syllable with tone 1', () => {
    expect(toNumberedPinyin('mā')).toBe('ma1');
    expect(toNumberedPinyin('hē')).toBe('he1');
    expect(toNumberedPinyin('chī')).toBe('chi1');
  });

  it('converts single syllable with tone 2', () => {
    expect(toNumberedPinyin('má')).toBe('ma2');
    expect(toNumberedPinyin('shí')).toBe('shi2');
    expect(toNumberedPinyin('hái')).toBe('hai2');
  });

  it('converts single syllable with tone 3', () => {
    expect(toNumberedPinyin('mǎ')).toBe('ma3');
    expect(toNumberedPinyin('hǎo')).toBe('hao3');
    expect(toNumberedPinyin('nǐ')).toBe('ni3');
  });

  it('converts single syllable with tone 4', () => {
    expect(toNumberedPinyin('mà')).toBe('ma4');
    expect(toNumberedPinyin('shì')).toBe('shi4');
    expect(toNumberedPinyin('dà')).toBe('da4');
  });

  it('handles neutral tone (no tone mark)', () => {
    expect(toNumberedPinyin('ma')).toBe('ma');
    expect(toNumberedPinyin('de')).toBe('de');
  });

  it('converts multiple syllables', () => {
    expect(toNumberedPinyin('nǐ hǎo')).toBe('ni3hao3');
    expect(toNumberedPinyin('zhōng guó')).toBe('zhong1guo2');
    expect(toNumberedPinyin('xué shēng')).toBe('xue2sheng1');
  });

  it('handles ü vowel and converts to v', () => {
    expect(toNumberedPinyin('lǖ')).toBe('lv1');
    expect(toNumberedPinyin('lǘ')).toBe('lv2');
    expect(toNumberedPinyin('lǚ')).toBe('lv3');
    expect(toNumberedPinyin('lǜ')).toBe('lv4');
    expect(toNumberedPinyin('nǚ')).toBe('nv3');
    expect(toNumberedPinyin('jué')).toBe('jue2');
  });

  it('converts to lowercase', () => {
    expect(toNumberedPinyin('MĀ')).toBe('ma1');
    expect(toNumberedPinyin('Nǐ Hǎo')).toBe('ni3hao3');
  });

  it('handles complex syllables', () => {
    expect(toNumberedPinyin('zhuāng')).toBe('zhuang1');
    expect(toNumberedPinyin('shuǐ')).toBe('shui3');
    expect(toNumberedPinyin('chuáng')).toBe('chuang2');
  });

  it('handles mixed tones in phrase', () => {
    expect(toNumberedPinyin('wǒ ài nǐ')).toBe('wo3ai4ni3');
    expect(toNumberedPinyin('zài jiàn')).toBe('zai4jian4');
  });
});
