import { describe, expect, it } from 'vitest';
import { effectivePolishStyle } from '../../src/shared/lib/polish-style';
import { getDefaultSettings } from '../../src/main/services/settings/types';

describe('effective polish style', () => {
  for (const style of ['auto', 'standard', 'cantonese'] as const) {
    it.each([null, 'yue', 'zh', 'en', 'ja'])(`resolves ${style} with language %s`, language => {
      const settings = getDefaultSettings({});
      settings.polish.style = style;
      settings.asr.language = language;
      expect(effectivePolishStyle(settings)).toBe(style === 'auto'
        ? (language === 'yue' ? 'cantonese' : 'standard') : style);
      expect(settings.polish.style).toBe(style);
    });
  }
});
