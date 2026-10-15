import { describe, expect, it, vi } from 'vitest';
import type { MediaAccessPermissionRequest, PermissionCheckHandlerHandlerDetails, Session } from 'electron';
import { decidePermission, installPermissionHandlers } from '../../src/main/security/permissions';
import { registerTrustedWindow, type WindowRole } from '../../src/main/ipc/sender';
import { mockWebContents } from './security-mocks';

const url = 'file:///app/index.html';

describe('permission policy', () => {
  it('allows audio-only capture and sanitized clipboard writes for main', () => {
    expect(decidePermission('main', 'media', ['audio'])).toBe(true);
    expect(decidePermission('main', 'media', ['audio', 'audio'])).toBe(true);
    expect(decidePermission('main', 'clipboard-sanitized-write')).toBe(true);
  });

  it.each([undefined, [], ['video'], ['audio', 'video'], ['unknown']].map((mediaTypes) => ({ mediaTypes })))('denies missing or non-audio media types: $mediaTypes', ({ mediaTypes }) => {
    expect(decidePermission('main', 'media', mediaTypes)).toBe(false);
  });

  it.each(['floating', undefined] as const)('denies all permissions for role %s', (role) => {
    expect(decidePermission(role, 'media', ['audio'])).toBe(false);
    expect(decidePermission(role, 'clipboard-sanitized-write')).toBe(false);
  });

  it.each(['clipboard-read', 'display-capture', 'geolocation', 'notifications', 'openExternal', 'unknown', 'fileSystem'])('denies %s even for main', (permission) => {
    expect(decidePermission('main', permission, ['audio'])).toBe(false);
  });
});

function installedHandlers() {
  const setPermissionRequestHandler = vi.fn<Session['setPermissionRequestHandler']>();
  const setPermissionCheckHandler = vi.fn<Session['setPermissionCheckHandler']>();
  installPermissionHandlers({ setPermissionRequestHandler, setPermissionCheckHandler });
  const request = setPermissionRequestHandler.mock.calls[0][0];
  const check = setPermissionCheckHandler.mock.calls[0][0];
  if (!request || !check) throw new Error('Permission handlers not installed');
  return { request, check };
}

describe('permission handler installation', () => {
  it.each([
    { role: 'main', allowed: true },
    { role: 'floating', allowed: false },
    { role: undefined, allowed: false },
  ] satisfies { role: WindowRole | undefined; allowed: boolean }[])('applies the same role policy to requests and checks: $role', ({ role, allowed }) => {
    const { webContents } = mockWebContents(url);
    if (role) registerTrustedWindow(webContents, role);
    const { request, check } = installedHandlers();
    const callback = vi.fn();
    request(webContents, 'media', callback, { requestingUrl: url, isMainFrame: true, mediaTypes: ['audio'] } as MediaAccessPermissionRequest);
    expect(callback).toHaveBeenCalledWith(allowed);
    expect(check(webContents, 'media', 'file://', { requestingUrl: url, isMainFrame: true, mediaType: 'audio' })).toBe(allowed);
    request(webContents, 'clipboard-sanitized-write', callback, { requestingUrl: url, isMainFrame: true });
    expect(callback).toHaveBeenLastCalledWith(allowed);
    expect(check(webContents, 'clipboard-sanitized-write', 'file://', { requestingUrl: url, isMainFrame: true })).toBe(allowed);
  });

  it('denies subframes, mismatched request URLs, missing URLs and absent web contents', () => {
    const { webContents } = mockWebContents(url);
    registerTrustedWindow(webContents, 'main');
    const { request, check } = installedHandlers();
    const callback = vi.fn();
    for (const details of [
      { requestingUrl: url, isMainFrame: false },
      { requestingUrl: 'file:///other.html', isMainFrame: true },
    ]) {
      request(webContents, 'media', callback, { ...details, mediaTypes: ['audio'] } as MediaAccessPermissionRequest);
      expect(callback).toHaveBeenLastCalledWith(false);
      expect(check(webContents, 'media', 'file://', { ...details, mediaType: 'audio' })).toBe(false);
    }
    expect(check(webContents, 'media', 'file://', { isMainFrame: true, mediaType: 'audio' })).toBe(false);
    expect(check(null, 'media', 'file://', { requestingUrl: url, isMainFrame: true, mediaType: 'audio' })).toBe(false);
  });

  it('normalizes request mediaTypes and check mediaType, denying camera and unknown types', () => {
    const { webContents } = mockWebContents(url);
    registerTrustedWindow(webContents, 'main');
    const { request, check } = installedHandlers();
    const callback = vi.fn();
    request(webContents, 'media', callback, { requestingUrl: url, isMainFrame: true, mediaTypes: ['audio', 'video'] } as MediaAccessPermissionRequest);
    expect(callback).toHaveBeenCalledWith(false);
    for (const mediaType of ['video', 'unknown', undefined] as const) {
      const details: PermissionCheckHandlerHandlerDetails = { requestingUrl: url, isMainFrame: true, mediaType };
      expect(check(webContents, 'media', 'file://', details)).toBe(false);
    }
  });

  it('revokes permissions after navigation or destruction', () => {
    const { webContents, mainFrame, events } = mockWebContents(url);
    registerTrustedWindow(webContents, 'main');
    const { request, check } = installedHandlers();
    const callback = vi.fn();
    mainFrame.url = 'file:///other.html';
    request(webContents, 'media', callback, { requestingUrl: mainFrame.url, isMainFrame: true, mediaTypes: ['audio'] } as MediaAccessPermissionRequest);
    expect(callback).toHaveBeenCalledWith(false);
    expect(check(webContents, 'media', 'file://', { requestingUrl: mainFrame.url, isMainFrame: true, mediaType: 'audio' })).toBe(false);
    mainFrame.url = url;
    events.emit('destroyed');
    expect(check(webContents, 'clipboard-sanitized-write', 'file://', { requestingUrl: url, isMainFrame: true })).toBe(false);
    webContents.isDestroyed = () => true;
    Object.defineProperty(webContents, 'mainFrame', { get: () => { throw new Error('destroyed'); } });
    request(webContents, 'clipboard-sanitized-write', callback, { requestingUrl: url, isMainFrame: true });
    expect(callback).toHaveBeenLastCalledWith(false);
    expect(check(webContents, 'media', 'file://', { requestingUrl: url, isMainFrame: true, mediaType: 'audio' })).toBe(false);
  });
});
