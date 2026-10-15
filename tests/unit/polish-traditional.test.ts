import { describe, expect, it } from 'vitest';
import { hasSimplifiedCharacters, toTraditional } from '../../src/main/services/polish/lib/traditional';

describe('toTraditional', () => {
  it('converts Simplified text with Taiwan character forms', () => {
    expect(toTraditional('我们今天先处理 Open Typeless 的 bug，然后再看一下 CI。'))
      .toBe('我們今天先處理 Open Typeless 的 bug，然後再看一下 CI。');
    expect(toTraditional('这个软件在后台运行')).toBe('這個軟件在後台運行');
  });

  it('keeps the common 台 instead of 臺', () => {
    expect(toTraditional('我们去台北看电视台')).toBe('我們去台北看電視台');
  });

  it('leaves Traditional text untouched, including characters shared with Simplified', () => {
    for (const text of ['准許他吃麵', '電視台和台北', '了解一下', '說云', '丑時', '幫我把這段翻譯成英文。']) {
      expect(hasSimplifiedCharacters(text)).toBe(false);
      expect(toTraditional(text)).toBe(text);
    }
  });

  it('leaves Cantonese, English and empty text untouched', () => {
    for (const text of ['我哋聽日食咗飯先再傾呢個 project 好唔好？', '佢話佢唔記得咗帶鎖匙', '着數', 'push the release', '']) {
      expect(toTraditional(text)).toBe(text);
    }
  });
});
