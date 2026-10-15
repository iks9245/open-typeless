import { describe, expect, it, vi } from 'vitest';
import { LoginItemService } from '../../src/main/services/login-item/login-item.service';

function fixture(isPackaged = true, platform = 'darwin') {
  const settings: { openAtLogin: boolean; wasOpenedAtLogin: boolean; status?: string } = {
    openAtLogin: false, wasOpenedAtLogin: false,
  };
  const getLoginItemSettings = vi.fn(() => ({ ...settings }));
  const setLoginItemSettings = vi.fn((next: { openAtLogin: boolean }) => { Object.assign(settings, next); });
  const service = new LoginItemService({ isPackaged, platform, getLoginItemSettings, setLoginItemSettings });
  return { service, settings, getLoginItemSettings, setLoginItemSettings };
}

describe('login item OS state', () => {
  it.each([[false, 'darwin'], [true, 'linux'], [true, 'win32']] as const)('does not read or mutate unsupported OS state (%s, %s)', (packaged, platform) => {
    const { service, getLoginItemSettings, setLoginItemSettings } = fixture(packaged, platform);
    const unsupported = { supported: false, enabled: false, requiresApproval: false };
    expect(service.get()).toEqual(unsupported);
    expect(service.set(true)).toEqual(unsupported);
    expect(getLoginItemSettings).not.toHaveBeenCalled();
    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });

  it('reads fresh OS state and handles absent and requires-approval status', () => {
    const { service, settings } = fixture();
    expect(service.get()).toEqual({ supported: true, enabled: false, requiresApproval: false });
    settings.openAtLogin = true;
    settings.status = 'requires-approval';
    expect(service.get()).toEqual({ supported: true, enabled: true, requiresApproval: true });
    settings.status = 'enabled';
    expect(service.get().requiresApproval).toBe(false);
  });

  it('sets the login item and returns the fresh state', () => {
    const { service, setLoginItemSettings, getLoginItemSettings } = fixture();
    expect(service.set(true)).toEqual({ supported: true, enabled: true, requiresApproval: false });
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true });
    expect(service.set(false).enabled).toBe(false);
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false });
    expect(getLoginItemSettings).toHaveBeenCalledTimes(2);
  });

  it('returns actual OS state even if a write has not taken effect', () => {
    const { service, setLoginItemSettings } = fixture();
    setLoginItemSettings.mockImplementation(() => undefined);
    expect(service.set(true).enabled).toBe(false);
  });

  it('detects login launches only on macOS', () => {
    const mac = fixture();
    expect(mac.service.wasOpenedAtLogin()).toBe(false);
    mac.settings.wasOpenedAtLogin = true;
    expect(mac.service.wasOpenedAtLogin()).toBe(true);
    const linux = fixture(true, 'linux');
    linux.settings.wasOpenedAtLogin = true;
    expect(linux.service.wasOpenedAtLogin()).toBe(false);
    expect(linux.getLoginItemSettings).not.toHaveBeenCalled();
  });
});
