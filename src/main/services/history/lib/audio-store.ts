/**
 * Private asynchronous WAV storage beneath an explicit audio directory.
 * Checks lexical and real paths to reject traversal and escaping symlinks.
 */

import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

function isInside(root: string, filename: string): boolean {
  const relative = path.relative(root, filename);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function resolveAudioPath(audioDir: string, relativePath: string): string {
  const root = path.resolve(audioDir);
  const filename = path.resolve(root, relativePath);
  if (path.isAbsolute(relativePath) || !isInside(root, filename)) {
    throw new Error('Audio path must stay inside the audio directory');
  }
  return filename;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function verifyRealPath(root: string, filename: string): Promise<void> {
  const realRoot = await realpath(root);
  let ancestor = filename;
  while (ancestor !== path.dirname(ancestor)) {
    try {
      const resolved = await realpath(ancestor);
      if (resolved !== realRoot && !isInside(realRoot, resolved)) {
        throw new Error('Audio path resolves outside the audio directory');
      }
      return;
    } catch (error) {
      if (!isMissing(error)) throw error;
      // Reject dangling symlinks rather than treating them as missing files.
      try {
        if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('Invalid audio symlink');
      } catch (statError) {
        if (!isMissing(statError)) throw statError;
      }
      ancestor = path.dirname(ancestor);
    }
  }
  throw new Error('Cannot resolve audio directory');
}

export async function writeAudio(
  audioDir: string,
  id: string,
  createdAt: number,
  wav: Buffer,
): Promise<string> {
  if (!/^[0-9a-f-]+$/i.test(id)) throw new Error('Invalid audio identifier');
  const date = new Date(createdAt);
  const relativePath = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${id}.wav`;
  const filename = resolveAudioPath(audioDir, relativePath);
  const root = path.resolve(audioDir);
  await mkdir(root, { recursive: true });
  await verifyRealPath(root, filename);
  await mkdir(path.dirname(filename), { recursive: true });
  await verifyRealPath(root, filename);
  const file = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(wav);
  } catch (error) {
    await file.close();
    await deleteAudio(audioDir, relativePath);
    throw error;
  }
  await file.close();
  return relativePath;
}

export async function deleteAudio(audioDir: string, relativePath: string): Promise<void> {
  const filename = resolveAudioPath(audioDir, relativePath);
  try {
    await verifyRealPath(path.resolve(audioDir), filename);
    await unlink(filename);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

/** Remove orphan WAV files too, without following directory symlinks. */
export async function clearAudio(audioDir: string): Promise<void> {
  async function visit(relativeDir: string): Promise<void> {
    const directory = relativeDir === '' ? path.resolve(audioDir) : resolveAudioPath(audioDir, relativeDir);
    if (relativeDir !== '') await verifyRealPath(path.resolve(audioDir), directory);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) await visit(relativePath);
      else if (entry.name.endsWith('.wav')) await deleteAudio(audioDir, relativePath);
    }
  }
  try {
    await visit('');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}
