import type { AppSettings } from '../types/settings';

export type EffectivePolishStyle = Exclude<AppSettings['polish']['style'], 'auto'>;

export function effectivePolishStyle(settings: Pick<AppSettings, 'polish' | 'asr'>): EffectivePolishStyle {
  return settings.polish.style === 'auto'
    ? (settings.asr.language === 'yue' ? 'cantonese' : 'standard')
    : settings.polish.style;
}
