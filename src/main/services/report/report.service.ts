import { and, eq, gte, lt } from 'drizzle-orm';
import { transcriptions } from '../../db/schema';
import type { ReportComment, SpeechReport } from '../../../shared/types/report';
import type { IpcResult } from '../../../shared/types/common';
import { createCompletion, OmlxHttpError } from '../polish/lib/omlx-client';
import { readOmlxConfig } from '../polish/lib/omlx-config';
import { withOmlxTimeout } from '../polish/lib/timeout';
import { stripThinking, stripWrappingQuotes } from '../polish/lib/sanitize';
import { reportInputSchema, type ReportDependencies } from './types';
import { buildReport, reportWindow } from './lib/metrics';
import { buildCommentMessages } from './lib/comment-prompt';

export class ReportService {
  constructor(private readonly deps: ReportDependencies) {}

  build(input: unknown): IpcResult<SpeechReport> {
    const parsed = reportInputSchema.safeParse(input);
    if (parsed.success === false) return { success: false, error: 'Invalid report range' };
    try {
      const now = this.deps.now();
      const { previousStart } = reportWindow(parsed.data.range, now);
      const rows = this.deps.getDb().select({
        createdAt: transcriptions.createdAt, mode: transcriptions.mode,
        rawText: transcriptions.rawText, finalText: transcriptions.finalText,
        audioDurationMs: transcriptions.audioDurationMs, latencyMs: transcriptions.latencyMs,
      }).from(transcriptions).where(and(
        eq(transcriptions.status, 'completed'), lt(transcriptions.createdAt, now),
        previousStart === null ? undefined : gte(transcriptions.createdAt, previousStart),
      )).all();
      return { success: true, data: buildReport(rows, parsed.data.range, now) };
    } catch {
      this.deps.logger.warn('Failed to build speech report');
      return { success: false, error: 'Report storage is unavailable' };
    }
  }

  async comment(input: unknown): Promise<ReportComment> {
    const report = this.build(input);
    if (report.success === false) return { error: report.error };
    try {
      const settings = this.deps.getSettings();
      if (settings.success === false) return { error: 'Settings are unavailable' };
      const output = await withOmlxTimeout(this.deps.timers, 30000, async signal => {
        const config = await readOmlxConfig(this.deps);
        if (!config) throw new Error('oMLX not installed');
        return createCompletion(config, {
          model: settings.data.command.model, messages: buildCommentMessages(report.data), maxTokens: 200,
        }, this.deps.fetch, signal);
      });
      const text = stripWrappingQuotes(stripThinking(output).trim());
      if (!text) throw new Error('Empty command output');
      return { text };
    } catch (error) {
      const known = ['oMLX not installed', 'oMLX request timed out', 'Empty command output',
        'Invalid oMLX JSON response', 'Invalid oMLX completion response'];
      const message = error instanceof OmlxHttpError ? error.message
        : error instanceof Error && known.includes(error.message) ? error.message : 'oMLX request failed';
      this.deps.logger.warn('Report comment request failed');
      return { error: message };
    }
  }
}
