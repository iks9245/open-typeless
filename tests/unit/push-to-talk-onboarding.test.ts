import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(), accessibility: vi.fn(), microphone: vi.fn(), register: vi.fn(), unregister: vi.fn(),
  dialog: vi.fn(), appOn: vi.fn(), appOff: vi.fn(), settingsOn: vi.fn(), settingsOff: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { on: mocks.appOn, off: mocks.appOff, getName: () => 'WaaE' },
  BrowserWindow: { getAllWindows: () => [] }, dialog: { showMessageBox: mocks.dialog },
}));
vi.mock('../../src/main/services/settings', () => ({ settingsService: {
  get: mocks.settings, on: mocks.settingsOn, off: mocks.settingsOff,
} }));
vi.mock('../../src/main/services/permissions', () => ({ permissionsService: {
  getAccessibilityStatus: mocks.accessibility, requestMicrophonePermission: mocks.microphone, logPermissionStatus: vi.fn(), openSettings: vi.fn(),
} }));
vi.mock('../../src/main/services/keyboard', () => ({ keyboardService: {
  setTriggerKey: vi.fn(), isActive: false, register: mocks.register, unregister: mocks.unregister,
} }));
vi.mock('../../src/main/services/asr', () => ({ asrService: {} }));
vi.mock('../../src/main/services/text-input', () => ({ textInputService: {} }));
vi.mock('../../src/main/services/history', () => ({ historyService: {} }));
vi.mock('../../src/main/services/command', () => ({ commandService: {} }));
vi.mock('../../src/main/services/polish', () => ({ polishService: {} }));
vi.mock('../../src/main/services/memory', () => ({ memoryService: {} }));
vi.mock('../../src/main/windows', () => ({ floatingWindow: {} }));
import { PushToTalkService } from '../../src/main/services/push-to-talk/push-to-talk.service';
import { getDefaultSettings } from '../../src/main/services/settings/types';

let service: PushToTalkService;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.accessibility.mockReturnValue(false);
  mocks.microphone.mockResolvedValue(false);
  mocks.register.mockReturnValue(true);
  mocks.dialog.mockResolvedValue({ response: 1 });
  service = new PushToTalkService();
});
afterEach(() => { service.dispose(); vi.useRealTimers(); });
const configure = (completed: boolean) => {
  const settings = getDefaultSettings({});
  settings.onboarding.completed = completed;
  mocks.settings.mockReturnValue({ success: true, data: settings });
};

describe('push-to-talk onboarding permissions', () => {
  it('suppresses startup dialogs during onboarding but keeps polling and starts the hook after a grant', () => {
    configure(false);
    service.initialize();
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(mocks.microphone).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.appOn).toHaveBeenCalledWith('did-become-active', expect.any(Function));
    vi.advanceTimersByTime(2000);
    expect(mocks.register).not.toHaveBeenCalled();
    mocks.accessibility.mockReturnValue(true);
    vi.advanceTimersByTime(2000);
    expect(mocks.register).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(4000);
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.dialog).not.toHaveBeenCalled();
  });
  it('retains startup guidance and microphone requests for completed users', () => {
    configure(true);
    service.initialize();
    expect(mocks.microphone).toHaveBeenCalledOnce();
    expect(mocks.dialog).toHaveBeenCalledOnce();
    expect(mocks.dialog.mock.calls[0][0]).toMatchObject({ message: 'Accessibility permission required' });
  });
  it('suppresses guidance if settings cannot be read and cleans up polling on dispose', () => {
    mocks.settings.mockReturnValue({ success: false, error: 'unavailable' });
    service.initialize();
    expect(mocks.dialog).not.toHaveBeenCalled();
    service.dispose();
    mocks.accessibility.mockReturnValue(true);
    vi.advanceTimersByTime(4000);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.appOff).toHaveBeenCalledWith('did-become-active', expect.any(Function));
  });
});
