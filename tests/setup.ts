/**
 * Shared unit-test setup.
 * Silences electron-log so tests neither clutter output nor write to the real log file.
 */

import log from 'electron-log';

log.transports.console.level = false;
log.transports.file.level = false;
