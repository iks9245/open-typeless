// Imported first by main.ts: run before other services can access storage or userData.
import { app, dialog } from 'electron';
import log from 'electron-log';
import { legacyMigrationDefaults, migrateLegacyData } from './legacy-data';

export const legacyMigration = migrateLegacyData(app.getPath('appData'), app.getPath('userData'), {
  ...legacyMigrationDefaults,
  showMessage: message => { dialog.showMessageBoxSync({ type: 'info', title: 'WaaE', message }); },
  exit: code => app.exit(code),
  logger: log.scope('legacy-migration'),
});
