/**
 * Application settings shared with the renderer.
 * Runtime validation belongs to the main-process settings service.
 */

export interface AppSettings {
  history: {
    enabled: boolean;
    saveAudio: boolean;
    retentionDays: number | null;
  };
  asr: {
    language: string | null;
    whisperServerUrl: string;
    /** Proper nouns and terms that recognition should favor */
    vocabulary: string[];
  };
  input: {
    autoInsert: boolean;
  };
}

export interface AppSettingsPatch {
  history?: Partial<AppSettings['history']>;
  asr?: Partial<AppSettings['asr']>;
  input?: Partial<AppSettings['input']>;
}
