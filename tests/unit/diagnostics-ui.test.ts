import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FEEDBACK_URL } from '../../src/shared/constants/support';
import { AboutSection } from '../../src/renderer/src/modules/main-window/components/AboutSection';
import { SettingsProvider } from '../../src/renderer/src/modules/main-window/hooks/SettingsContext';
import { forwardConsoleErrors } from '../../src/main/windows/console';
import { mockWebContents } from './security-mocks';
import log from 'electron-log';

describe('About and renderer error capture', () => {
  it('hides feedback when the owner has not chosen a channel', () => {
    expect(FEEDBACK_URL).toBeNull();
    const html = renderToStaticMarkup(createElement(SettingsProvider, null, createElement(AboutSection, { active: false })));
    expect(html).toContain('about-heading');
    expect(html).toContain('about-copy');
    expect(html).toContain('about-export-diagnostics');
    expect(html).not.toContain('about-feedback');
    expect(html).not.toContain('回報問題');
  });
  it.each(['main', 'floating'] as const)('forwards only %s console errors, with basename and line', role => {
    const { webContents, events } = mockWebContents();
    const spy = vi.spyOn(log, 'error').mockImplementation(() => undefined);
    try {
      forwardConsoleErrors(webContents, role);
      for (const level of ['debug', 'info', 'warning']) events.emit('console-message', { level, message: 'ignore', sourceId: '', lineNumber: 1 });
      expect(spy).not.toHaveBeenCalled();
      events.emit('console-message', { level: 'error', message: 'Error: test\n at function (index.js:32)', sourceId: 'file:///Users/tester/app/index.js?private=1', lineNumber: 32 });
      expect(spy).toHaveBeenCalledWith(`(renderer:${role})`, 'Error: test\n at function (index.js:32)', { file: 'index.js', line: 32 });
    } finally { spy.mockRestore(); }
  });
});
