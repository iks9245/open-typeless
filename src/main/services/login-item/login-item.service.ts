import type { LoginItemState } from '../../../shared/types/system';

interface LoginItemDependencies {
  isPackaged: boolean;
  platform: string;
  getLoginItemSettings: () => { openAtLogin: boolean; wasOpenedAtLogin?: boolean; status?: string };
  setLoginItemSettings: (settings: { openAtLogin: boolean }) => void;
}

export class LoginItemService {
  constructor(private readonly deps: LoginItemDependencies) {}

  get(): LoginItemState {
    const supported = this.deps.isPackaged && this.deps.platform === 'darwin';
    if (!supported) return { supported, enabled: false, requiresApproval: false };
    const settings = this.deps.getLoginItemSettings();
    return { supported, enabled: settings.openAtLogin, requiresApproval: settings.status === 'requires-approval' };
  }

  set(enabled: boolean): LoginItemState {
    if (this.deps.isPackaged && this.deps.platform === 'darwin') {
      this.deps.setLoginItemSettings({ openAtLogin: enabled });
    }
    return this.get();
  }

  wasOpenedAtLogin(): boolean {
    return this.deps.platform === 'darwin' && Boolean(this.deps.getLoginItemSettings().wasOpenedAtLogin);
  }
}
