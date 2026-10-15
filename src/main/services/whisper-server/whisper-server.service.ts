/**
 * Local whisper.cpp lifecycle with verified adoption, readiness and bounded restarts.
 * All operating system, network and timing dependencies are supplied by the facade.
 */

import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { discoverWhisperServer, resolveWhisperEndpoint } from './lib/discovery';
import { findOwnedWhisperProcess, removeWhisperPid, writeWhisperPid } from './lib/ownership';
import type { WhisperLaunchPlan, WhisperPidRecord, WhisperServerDependencies, WhisperServerStatus } from './types';

interface OwnedProcess {
  record: WhisperPidRecord;
  path: string;
  child: ChildProcess | null;
  exited: boolean;
  written: Promise<void>;
  removal: Promise<void> | null;
}

const INITIAL_STATUS: WhisperServerStatus = {
  mode: 'none', state: 'idle', pid: null, binary: null, model: null, vadModel: null, reason: null,
};

export class WhisperServerService {
  private current: WhisperServerStatus = { ...INITIAL_STATUS };
  private owned: OwnedProcess | null = null;
  private generation = 0;
  private startTask: Promise<void> | null = null;
  private stopTask: Promise<void> | null = null;
  private readonly cancellations = new Set<() => void>();
  private readonly listeners = new Set<() => void>();
  private readonly output: string[] = [];
  private crashes: number[] = [];

  constructor(private readonly deps: WhisperServerDependencies) {}

  status(): WhisperServerStatus {
    return { ...this.current };
  }

  start(): Promise<void> {
    if (this.stopTask !== null) return this.stopTask.then(() => this.start());
    if (this.startTask !== null) return this.startTask;
    if (this.current.state === 'ready' || this.current.state === 'starting') return Promise.resolve();
    // A failed but still-owned process must be stopped before another can be launched.
    if (this.owned !== null && !this.owned.exited) return Promise.resolve();
    const generation = ++this.generation;
    this.crashes = [];
    this.output.length = 0;
    this.update({ ...INITIAL_STATUS, state: 'starting' });
    const task = this.startServer(generation).catch(error => {
      if (generation === this.generation) this.fail('Failed to start whisper-server', error);
    });
    this.startTask = task;
    void task.then(() => { if (this.startTask === task) this.startTask = null; });
    return task;
  }

  waitUntilReady(timeoutMs: number): Promise<boolean> {
    if (this.current.state === 'ready') return Promise.resolve(true);
    if (this.isTerminal()) return Promise.resolve(false);
    return new Promise(resolve => {
      const finish = (ready: boolean): void => {
        this.deps.timers.clearTimeout(timer);
        this.listeners.delete(changed);
        resolve(ready);
      };
      const changed = (): void => {
        if (this.current.state === 'ready') finish(true);
        else if (this.isTerminal()) finish(false);
      };
      const timer = this.deps.timers.setTimeout(() => finish(false), Math.max(0, timeoutMs));
      this.listeners.add(changed);
      changed();
    });
  }

  /** Signal synchronously so Electron's before-quit caller need not await to send SIGTERM. */
  stop(): Promise<void> {
    if (this.stopTask !== null) return this.stopTask;
    const owned = this.owned;
    if (owned === null && this.current.state !== 'starting') return Promise.resolve();
    ++this.generation;
    this.cancelWork();
    this.update({ state: 'stopped', reason: null });
    if (owned !== null) this.signal(owned, 'SIGTERM');
    const starting = this.startTask;
    const task = (async (): Promise<void> => {
      if (owned !== null) {
        const deadline = this.deps.now() + 3000;
        while (this.isAlive(owned) && this.deps.now() < deadline) {
          await new Promise<void>(resolve => this.deps.timers.setTimeout(resolve, 100));
        }
        if (this.isAlive(owned)) this.signal(owned, 'SIGKILL');
        await this.removePid(owned);
      }
      // A pending ownership lookup or PID write must finish before a subsequent start.
      await starting;
      this.owned = null;
      this.update({ pid: null });
    })().catch(error => {
      this.deps.logger.error('Failed to stop whisper-server', { error });
    });
    this.stopTask = task;
    void task.then(() => { if (this.stopTask === task) this.stopTask = null; });
    return task;
  }

  private async startServer(generation: number): Promise<void> {
    if (this.owned?.exited) {
      await this.removePid(this.owned);
      if (generation === this.generation) this.owned = null;
    }
    if (generation !== this.generation) return;
    const serverUrl = this.deps.getServerUrl();
    const endpoint = resolveWhisperEndpoint(serverUrl);
    if (endpoint.local === false) {
      this.update({ mode: 'external', state: 'ready' });
      return;
    }
    const discovery = discoverWhisperServer(serverUrl, this.deps.discovery);
    const path = this.deps.pidFilePath();
    const record = await findOwnedWhisperProcess(path, endpoint.port, this.deps.ownership);
    if (generation !== this.generation) return;
    if (record !== null) {
      const owned: OwnedProcess = { record, path, child: null, exited: false, written: Promise.resolve(), removal: null };
      this.owned = owned;
      this.update({
        mode: 'adopted', pid: record.pid, binary: record.binary,
        model: discovery.available === true ? discovery.plan.model : null,
        vadModel: discovery.available === true ? discovery.plan.vadModel : null,
      });
      await this.pollReady(owned, endpoint.managedUrl, generation);
      if (this.active(owned, generation) && this.current.state === 'ready') {
        void this.monitorAdopted(owned, generation).catch(error => {
          if (this.active(owned, generation)) this.fail('Failed to monitor adopted whisper-server', error);
        });
      }
      return;
    }
    // Probe both loopback aliases concurrently within the same one-second budget.
    const urls = [...new Set([endpoint.url, endpoint.managedUrl])];
    const healthy = await Promise.all(urls.map(url => this.checkHealth(url, 1000)));
    if (generation !== this.generation) return;
    if (healthy.some(Boolean)) {
      this.update({ mode: 'external', state: 'ready' });
      return;
    }
    if (discovery.available === false) {
      this.update({ mode: 'unavailable', state: 'failed', reason: discovery.reason });
      this.deps.logger.warn('whisper-server unavailable', { reason: discovery.reason });
      return;
    }
    await this.launch(discovery.plan, endpoint.managedUrl, path, generation);
  }

  private async launch(plan: WhisperLaunchPlan, url: string, path: string, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    this.update({ mode: 'managed', state: 'starting', binary: plan.binary, model: plan.model, vadModel: plan.vadModel, reason: null });
    const child = this.deps.spawn(plan.binary, plan.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', error => {
      if (generation === this.generation) this.fail('whisper-server process error', error);
    });
    this.captureOutput(child.stdout);
    this.captureOutput(child.stderr);
    if (child.pid === undefined) {
      this.fail('whisper-server did not receive a PID');
      return;
    }
    const record: WhisperPidRecord = { pid: child.pid, binary: plan.binary, port: plan.port, startedAt: this.deps.now() };
    const owned: OwnedProcess = { record, path, child, exited: false, written: Promise.resolve(), removal: null };
    this.owned = owned;
    child.once('exit', (code, signal) => {
      owned.exited = true;
      void this.onExit(owned, plan, url, generation, code, signal).catch(error => {
        if (generation === this.generation) this.fail('whisper-server restart failed', error);
      });
    });
    this.update({ pid: record.pid });
    owned.written = writeWhisperPid(path, record, this.deps.ownership).catch(error => {
      this.deps.logger.warn('Failed to write whisper-server PID file', { error });
    });
    await owned.written;
    if (this.active(owned, generation) && this.current.state === 'starting') {
      await this.pollReady(owned, url, generation);
    }
  }

  private async pollReady(owned: OwnedProcess, url: string, generation: number): Promise<void> {
    const deadline = this.deps.now() + 60000;
    while (this.active(owned, generation) && this.current.state === 'starting') {
      if (!this.isAlive(owned)) {
        owned.exited = true;
        this.update({ pid: null });
        this.fail('whisper-server exited before becoming ready');
        await this.removePid(owned);
        return;
      }
      const remaining = deadline - this.deps.now();
      if (remaining <= 0) {
        this.fail('whisper-server readiness timed out after 60 seconds');
        return;
      }
      const started = this.deps.now();
      const healthy = await this.checkHealth(url, Math.min(1000, remaining));
      if (!this.active(owned, generation) || this.current.state !== 'starting') return;
      if (healthy && this.isAlive(owned) && this.deps.now() < deadline) {
        this.update({ state: 'ready', reason: null });
        this.deps.logger.info('whisper-server ready', { mode: this.current.mode, pid: owned.record.pid });
        return;
      }
      await this.delay(Math.max(0, Math.min(500 - (this.deps.now() - started), deadline - this.deps.now())));
    }
  }

  private async onExit(
    owned: OwnedProcess, plan: WhisperLaunchPlan, url: string, generation: number,
    code: number | null, signal: NodeJS.Signals | null,
  ): Promise<void> {
    if (this.owned !== owned || generation !== this.generation) return;
    const wasReady = this.current.state === 'ready';
    this.cancelWork();
    this.update({ pid: null });
    if (!wasReady) {
      this.fail('whisper-server exited before becoming ready', { code, signal });
      await this.removePid(owned);
      return;
    }
    const now = this.deps.now();
    this.crashes = this.crashes.filter(time => now - time < 60000);
    this.crashes.push(now);
    if (this.crashes.length > 3) {
      this.fail('whisper-server exceeded 3 unexpected exits within 60 seconds', { code, signal });
      await this.removePid(owned);
      return;
    }
    const backoffMs = 1000 * 2 ** (this.crashes.length - 1);
    this.update({ state: 'starting', reason: null });
    this.deps.logger.warn('whisper-server exited unexpectedly; restarting', { code, signal, backoffMs });
    await this.removePid(owned);
    if (generation !== this.generation) return;
    await this.delay(backoffMs);
    if (generation === this.generation) await this.launch(plan, url, owned.path, generation);
  }

  private async monitorAdopted(owned: OwnedProcess, generation: number): Promise<void> {
    while (this.active(owned, generation) && this.current.state === 'ready') {
      await this.delay(500);
      if (!this.active(owned, generation)) return;
      if (!this.isAlive(owned)) {
        owned.exited = true;
        this.update({ pid: null });
        this.fail('Adopted whisper-server exited');
        await this.removePid(owned);
        return;
      }
    }
  }

  private checkHealth(url: string, timeoutMs: number): Promise<boolean> {
    return new Promise(resolve => {
      const controller = new AbortController();
      let settled = false;
      const finish = (healthy: boolean): void => {
        if (settled) return;
        settled = true;
        this.deps.timers.clearTimeout(timer);
        this.cancellations.delete(cancel);
        controller.abort();
        resolve(healthy);
      };
      const cancel = (): void => finish(false);
      const timer = this.deps.timers.setTimeout(cancel, timeoutMs);
      this.cancellations.add(cancel);
      Promise.resolve().then(() => this.deps.healthCheck(url, controller.signal)).then(finish, () => finish(false));
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      const finish = (): void => {
        this.deps.timers.clearTimeout(timer);
        this.cancellations.delete(finish);
        resolve();
      };
      const timer = this.deps.timers.setTimeout(finish, ms);
      this.cancellations.add(finish);
    });
  }

  private cancelWork(): void {
    for (const cancel of this.cancellations) cancel();
  }

  private active(owned: OwnedProcess, generation: number): boolean {
    return this.owned === owned && !owned.exited && generation === this.generation;
  }

  private isAlive(owned: OwnedProcess): boolean {
    if (owned.exited) return false;
    if (owned.child !== null) return owned.child.exitCode === null && owned.child.signalCode === null;
    try {
      return this.deps.ownership.processAlive(owned.record.pid);
    } catch (error) {
      this.deps.logger.warn('Failed to inspect whisper-server process', { error });
      return false;
    }
  }

  private signal(owned: OwnedProcess, signal: NodeJS.Signals): void {
    if (!this.isAlive(owned)) return;
    try {
      if (owned.child !== null) owned.child.kill(signal);
      else this.deps.kill(owned.record.pid, signal);
    } catch (error) {
      this.deps.logger.warn('Failed to signal whisper-server', { pid: owned.record.pid, signal, error });
    }
  }

  private removePid(owned: OwnedProcess): Promise<void> {
    if (owned.removal !== null) return owned.removal;
    owned.removal = (async (): Promise<void> => {
      try {
        await owned.written;
        await removeWhisperPid(owned.path, this.deps.ownership);
      } catch (error) {
        this.deps.logger.warn('Failed to remove whisper-server PID file', { error });
      }
    })();
    return owned.removal;
  }

  private captureOutput(stream: Readable | null): void {
    if (stream === null) return;
    const decoder = new StringDecoder('utf8');
    let pending = '';
    const append = (text: string): void => {
      const lines = text.split('\n');
      pending = (pending + (lines.shift() ?? '')).slice(0, 300);
      for (const line of lines) {
        this.logOutput(pending.replace(/\r$/, ''));
        pending = line.slice(0, 300);
      }
    };
    stream.on('data', (chunk: Buffer | string) => append(typeof chunk === 'string' ? chunk : decoder.write(chunk)));
    stream.on('end', () => {
      append(decoder.end());
      if (pending) this.logOutput(pending.replace(/\r$/, ''));
    });
    stream.on('error', error => this.deps.logger.warn('Failed to read whisper-server output', { error }));
  }

  private logOutput(line: string): void {
    this.output.push(line);
    if (this.output.length > 20) this.output.shift();
    this.deps.logger.debug(`whisper-server: ${line}`);
  }

  private isTerminal(): boolean {
    return this.current.state === 'failed' || this.current.state === 'stopped' || this.current.mode === 'unavailable';
  }

  private update(patch: Partial<WhisperServerStatus>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener();
  }

  private fail(reason: string, error?: unknown): void {
    this.cancelWork();
    this.update({ state: 'failed', reason });
    this.deps.logger.error(reason, { error, output: [...this.output] });
  }
}
