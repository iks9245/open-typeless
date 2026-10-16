import { describe, expect, it, vi } from 'vitest';
import { captureSelection, type SelectionDependencies } from '../../src/main/services/command/lib/selection';

function fixture(formats = ['text/plain', 'text/html', 'text/rtf', 'image/png']) {
  let text = formats.includes('text/plain') ? 'original' : '';
  let now = 0;
  const image = { png: 'image', isEmpty: () => !formats.some(format => format.startsWith('image/')) };
  const deps: SelectionDependencies<typeof image> = {
    clipboard: {
      availableFormats: () => formats,
      readText: vi.fn(() => text), readHTML: () => (formats.includes('text/html') ? '<b>original</b>' : ''),
      readRTF: () => (formats.includes('text/rtf') ? '{rtf}' : ''), readImage: () => image,
      writeText: vi.fn(value => { text = value; }), write: vi.fn(), clear: vi.fn(),
    },
    waitForModifiersReleased: vi.fn(async () => true), keyTap: vi.fn(),
    sleep: vi.fn(async ms => { now += ms; }), now: () => now, logger: { warn: vi.fn() },
  };
  return { deps, image, copy: (value: string) => { text = value; } };
}

describe('selection capture', () => {
  it('copies the selected text and restores every supported clipboard type', async () => {
    const { deps, image, copy } = fixture();
    deps.keyTap = vi.fn(() => copy('private selection'));
    expect(await captureSelection(deps)).toBe('private selection');
    expect(deps.waitForModifiersReleased).toHaveBeenCalledWith(1500);
    expect(deps.clipboard.writeText).toHaveBeenCalledWith(expect.stringMatching(/^waae-selection-/));
    expect(deps.clipboard.write).toHaveBeenCalledWith({ text: 'original', html: '<b>original</b>', rtf: '{rtf}', image });
  });

  it('treats a changed clipboard containing empty text as a completed copy', async () => {
    const { deps, copy } = fixture();
    deps.keyTap = () => copy('');
    expect(await captureSelection(deps)).toBe('');
    expect(deps.clipboard.write).toHaveBeenCalledOnce();
  });

  it('polls for delayed copy, not just the first clipboard read', async () => {
    const { deps, copy } = fixture();
    deps.sleep = async ms => { if (ms === 20) copy('delayed selection'); };
    expect(await captureSelection(deps)).toBe('delayed selection');
  });

  it('restores only the flavors that were on the clipboard', async () => {
    const { deps, copy } = fixture(['text/plain']);
    (deps.keyTap as ReturnType<typeof vi.fn>).mockImplementation(() => copy('selected'));
    expect(await captureSelection(deps)).toBe('selected');
    expect(deps.clipboard.write).toHaveBeenCalledWith({ text: 'original' });
  });

  it('returns null after 400 ms and clears a previously empty clipboard', async () => {
    const { deps } = fixture([]);
    expect(await captureSelection(deps)).toBeNull();
    expect(deps.sleep).toHaveBeenCalledTimes(20);
    expect(deps.clipboard.clear).toHaveBeenCalledOnce();
    expect(deps.clipboard.write).not.toHaveBeenCalled();
  });

  it('does not touch the clipboard when modifiers time out', async () => {
    const { deps } = fixture();
    deps.waitForModifiersReleased = async () => false;
    await expect(captureSelection(deps)).rejects.toThrow('Release Shift to run the command');
    expect(deps.clipboard.readText).not.toHaveBeenCalled();
    expect(deps.keyTap).not.toHaveBeenCalled();
  });

  it.each(['keyTap', 'read', 'write sentinel'])('restores even when %s throws', async source => {
    const { deps } = fixture();
    if (source === 'keyTap') deps.keyTap = () => { throw new Error('copy failed'); };
    if (source === 'read') vi.mocked(deps.clipboard.readText).mockImplementationOnce(() => 'original').mockImplementation(() => { throw new Error('read failed'); });
    if (source === 'write sentinel') deps.clipboard.writeText = () => { throw new Error('write failed'); };
    await expect(captureSelection(deps)).rejects.toThrow('failed');
    expect(deps.clipboard.write).toHaveBeenCalledOnce();
  });

  it('warns with only unsupported format names', async () => {
    const { deps } = fixture(['text/plain', 'application/custom', 'public.file-url']);
    await captureSelection(deps);
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
    expect(deps.logger.warn).toHaveBeenCalledWith('Clipboard formats cannot be restored: application/custom, public.file-url');
  });
});
