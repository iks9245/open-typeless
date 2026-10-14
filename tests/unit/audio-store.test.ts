import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearAudio, deleteAudio, resolveAudioPath, writeAudio } from '../../src/main/services/history/lib/audio-store';

describe('audio store', () => {
  let directory: string;
  let audioDir: string;
  const id = '01929f55-0000-7000-8000-000000000001';
  const wav = Buffer.from('RIFF test audio');

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'typeless-audio-'));
    audioDir = path.join(directory, 'audio');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('writes bytes under the UTC year and month with mode 0600', async () => {
    // Local date is December 31, while UTC is already January 1.
    const relative = await writeAudio(audioDir, id, Date.parse('2025-12-31T23:30:00-02:00'), wav);
    expect(relative).toBe(`2026/01/${id}.wav`);
    const filename = path.join(audioDir, relative);
    expect(fs.readFileSync(filename)).toEqual(wav);
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
  });

  it('refuses to overwrite an existing recording', async () => {
    const createdAt = Date.UTC(2026, 9, 15);
    const relative = await writeAudio(audioDir, id, createdAt, wav);
    await expect(writeAudio(audioDir, id, createdAt, Buffer.from('replacement'))).rejects.toMatchObject({ code: 'EEXIST' });
    expect(fs.readFileSync(path.join(audioDir, relative))).toEqual(wav);
  });

  it.each(['../x', '/tmp/x', '.', ''])('rejects a path that escapes or resolves to the audio root: %j', (relative) => {
    expect(() => resolveAudioPath(audioDir, relative)).toThrow('Audio path must stay inside');
  });

  it('rejects writes and deletes through a directory symlink pointing outside the root', async () => {
    const outside = path.join(directory, 'outside');
    fs.mkdirSync(audioDir);
    fs.mkdirSync(path.join(outside, '10'), { recursive: true });
    fs.symlinkSync(outside, path.join(audioDir, '2026'), 'dir');
    const externalFile = path.join(outside, '10', `${id}.wav`);
    fs.writeFileSync(externalFile, wav);
    await expect(writeAudio(audioDir, id, Date.UTC(2026, 9, 15), wav)).rejects.toThrow('outside');
    await expect(deleteAudio(audioDir, `2026/10/${id}.wav`)).rejects.toThrow('outside');
    expect(fs.readFileSync(externalFile)).toEqual(wav);
    await expect(writeAudio(audioDir, id, Date.UTC(2026, 10, 15), wav)).rejects.toThrow('outside');
    expect(fs.existsSync(path.join(outside, '11'))).toBe(false);
  });

  it('succeeds when deleting a missing file or a file beneath a missing root', async () => {
    await expect(deleteAudio(audioDir, '2026/10/missing.wav')).resolves.toBeUndefined();
    fs.mkdirSync(audioDir);
    await expect(deleteAudio(audioDir, '2026/10/missing.wav')).resolves.toBeUndefined();
  });

  it('clears all WAV files including orphans while leaving other files', async () => {
    const relative = await writeAudio(audioDir, id, Date.UTC(2026, 9, 15), wav);
    const nested = path.join(audioDir, 'old', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'orphan.wav'), wav);
    fs.writeFileSync(path.join(audioDir, 'orphan.wav'), wav);
    fs.writeFileSync(path.join(nested, 'keep.txt'), 'keep');
    fs.writeFileSync(path.join(audioDir, 'keep.json'), '{}');
    await clearAudio(audioDir);
    expect(fs.existsSync(path.join(audioDir, relative))).toBe(false);
    expect(fs.existsSync(path.join(nested, 'orphan.wav'))).toBe(false);
    expect(fs.existsSync(path.join(audioDir, 'orphan.wav'))).toBe(false);
    expect(fs.readFileSync(path.join(nested, 'keep.txt'), 'utf8')).toBe('keep');
    expect(fs.readFileSync(path.join(audioDir, 'keep.json'), 'utf8')).toBe('{}');
  });
});
