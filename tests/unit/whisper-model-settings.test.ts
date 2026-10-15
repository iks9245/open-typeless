import { describe, expect, it, vi } from 'vitest';
import { getDefaultSettings } from '../../src/main/services/settings/types';

const mocks = vi.hoisted(() => ({ on: vi.fn(), changed: vi.fn(async () => undefined) }));
vi.mock('../../src/main/services/settings', () => ({
  settingsService: { get: () => ({ success: true, data: { asr: { model: null } } }), on: mocks.on },
}));
vi.mock('../../src/main/services/whisper-server/whisper-server.service', () => ({
  WhisperServerService: class { modelChanged = mocks.changed; },
}));
import { whisperServerService } from '../../src/main/services/whisper-server';

describe('whisper model settings subscription', () => {
  it('reacts only when the stored model changes, including resetting to automatic', async () => {
    expect(whisperServerService).toBeDefined();
    expect(mocks.on).toHaveBeenCalledWith('changed', expect.any(Function));
    const changed = mocks.on.mock.calls[0][1];
    const settings = getDefaultSettings({});
    changed(settings);
    settings.asr.language = 'yue';
    changed(settings);
    expect(mocks.changed).not.toHaveBeenCalled();
    settings.asr.model = 'app/cantonese.bin';
    changed(settings);
    changed(settings);
    expect(mocks.changed).toHaveBeenCalledTimes(1);
    settings.asr.model = null;
    changed(settings);
    expect(mocks.changed).toHaveBeenCalledTimes(2);
  });
});
