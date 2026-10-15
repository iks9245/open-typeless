/**
 * PID records are hints: verify both the live command and port before adoption.
 */

import { execFile } from 'node:child_process';
import type { WhisperOwnershipDependencies, WhisperPidRecord } from '../types';

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function commandOf(pid: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('ps', ['-p', String(pid), '-o', 'command='], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/** ps may print paths with spaces either quoted or unquoted. Stop at the next flag. */
export function modelFromCommand(command: string): string | null {
  const argument = command.match(/(?:^|\s)-m\s+("(?:\\.|[^"])*"|'[^']*'|.+?)(?=\s+--?[a-zA-Z][\w-]*(?:\s|=|$)|\s*$)/)?.[1];
  if (!argument) return null;
  return argument.replace(/^(["'])(.*)\1$/, '$2').replace(/\\([\s"'\\])/g, '$1');
}

export async function removeWhisperPid(path: string, deps: WhisperOwnershipDependencies): Promise<void> {
  try {
    await deps.unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function writeWhisperPid(
  path: string, record: WhisperPidRecord, deps: WhisperOwnershipDependencies,
): Promise<void> {
  await deps.writeFile(path, JSON.stringify(record));
}

export async function findOwnedWhisperProcess(
  path: string, port: number, deps: WhisperOwnershipDependencies,
): Promise<WhisperPidRecord | null> {
  let content: string;
  try {
    content = await deps.readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let record: WhisperPidRecord | null = null;
  try {
    const value: unknown = JSON.parse(content);
    if (typeof value === 'object' && value !== null && 'pid' in value && 'binary' in value &&
      'port' in value && 'startedAt' in value && typeof value.pid === 'number' &&
      Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.binary === 'string' &&
      value.binary.length > 0 && value.port === port && typeof value.startedAt === 'number' &&
      Number.isFinite(value.startedAt) && deps.processAlive(value.pid)) {
      const command = await deps.commandOf(value.pid);
      // Argument boundaries prevent --port 8080 matching --port 80801 or --port 8080x.
      const portArgument = new RegExp(`(?:^|\\s)--port\\s+${port}(?=\\s|$)`);
      if (command.includes(value.binary) && portArgument.test(command)) {
        record = { pid: value.pid, binary: value.binary, port, startedAt: value.startedAt };
      }
    }
  } catch {
    // Malformed records and uninspectable processes are never proof of ownership.
  }
  if (record === null) await removeWhisperPid(path, deps);
  return record;
}
