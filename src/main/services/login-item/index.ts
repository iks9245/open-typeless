import { app } from 'electron';
import { LoginItemService } from './login-item.service';

export { LoginItemService } from './login-item.service';
export const loginItemService = new LoginItemService({
  isPackaged: app.isPackaged,
  platform: process.platform,
  getLoginItemSettings: () => app.getLoginItemSettings(),
  setLoginItemSettings: settings => app.setLoginItemSettings(settings),
});
