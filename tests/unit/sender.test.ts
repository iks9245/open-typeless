import { describe, expect, it, vi } from 'vitest';
import type { WebFrameMain } from 'electron';
import { getTrustedWindowRole, isTrustedSender, registerTrustedWindow } from '../../src/main/ipc/sender';
import { mockIpcEvent, mockWebContents } from './security-mocks';

const url = 'file:///app/index.html';

describe('trusted window senders', () => {
  it('accepts the registered main frame only with its assigned role', () => {
    const { webContents } = mockWebContents(url);
    registerTrustedWindow(webContents, 'main');
    expect(isTrustedSender(mockIpcEvent(webContents), 'main')).toBe(true);
    expect(isTrustedSender(mockIpcEvent(webContents), 'floating')).toBe(false);
  });

  it('rejects unregistered windows even with the same local URL', () => {
    expect(isTrustedSender(mockIpcEvent(mockWebContents(url).webContents), 'main')).toBe(false);
  });

  it('rejects a subframe even with the same URL, and a missing frame', () => {
    const { webContents } = mockWebContents(url);
    registerTrustedWindow(webContents, 'main');
    expect(isTrustedSender(mockIpcEvent(webContents, { url } as WebFrameMain), 'main')).toBe(false);
    expect(isTrustedSender(mockIpcEvent(webContents, null), 'main')).toBe(false);
  });

  it.each([`${url}#other`, `${url}?other`, 'file:///app/other.html', 'https://example.com'])('rejects a URL mismatch: %s', (otherUrl) => {
    const { webContents, mainFrame } = mockWebContents(url);
    registerTrustedWindow(webContents, 'main');
    mainFrame.url = otherUrl;
    expect(isTrustedSender(mockIpcEvent(webContents), 'main')).toBe(false);
  });

  it('pins the first main-frame URL before IPC and never repins it', () => {
    const { webContents, mainFrame, events } = mockWebContents();
    registerTrustedWindow(webContents, 'floating');
    expect(isTrustedSender(mockIpcEvent(webContents), 'floating')).toBe(false);
    events.emit('did-start-navigation', {}, 'file:///subframe.html', false, false);
    mainFrame.url = url;
    events.emit('did-start-navigation', {}, url, false, true);
    expect(isTrustedSender(mockIpcEvent(webContents), 'floating')).toBe(true);
    mainFrame.url = 'file:///other.html';
    events.emit('did-start-navigation', {}, mainFrame.url, false, true);
    expect(isTrustedSender(mockIpcEvent(webContents), 'floating')).toBe(false);
  });

  it('unregisters on destroyed, even if isDestroyed has not yet changed', () => {
    const { webContents, events } = mockWebContents(url);
    registerTrustedWindow(webContents, 'main');
    events.emit('destroyed');
    expect(getTrustedWindowRole(webContents)).toBeUndefined();
    expect(isTrustedSender(mockIpcEvent(webContents), 'main')).toBe(false);
  });

  it('rejects destroyed web contents without accessing its main frame', () => {
    const { webContents } = mockWebContents(url);
    registerTrustedWindow(webContents, 'main');
    webContents.isDestroyed = () => true;
    Object.defineProperty(webContents, 'mainFrame', { get: () => { throw new Error('destroyed'); } });
    expect(isTrustedSender(mockIpcEvent(webContents, null), 'main')).toBe(false);
  });

  it.each(['will-navigate', 'will-redirect'])('allows only exact reloads on %s', (eventName) => {
    const { webContents, events } = mockWebContents(url);
    registerTrustedWindow(webContents, 'main');
    const preventDefault = vi.fn();
    events.emit(eventName, { preventDefault }, url);
    expect(preventDefault).not.toHaveBeenCalled();
    for (const otherUrl of [`${url}#hash`, `${url}?query`, 'file:///other.html', 'https://example.com']) {
      events.emit(eventName, { preventDefault }, otherUrl);
    }
    expect(preventDefault).toHaveBeenCalledTimes(4);
  });
});
