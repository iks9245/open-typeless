import type { AskResult } from '../../../../../shared/types/memory';
/**
 * Floating Window Component.
 * The main component for the ASR floating window that displays status and transcription.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { floatingApi } from '../../../../floating/api';
import type { InputMode } from '../../../../../shared/constants/command';
import { useASRStatus } from '../hooks';
import { StatusIndicator } from './StatusIndicator';
import { TranscriptDisplay } from './TranscriptDisplay';
import { ErrorDisplay } from './ErrorDisplay';

/**
 * Main floating window component that displays ASR status and transcription results.
 *
 * The window shows:
 * - Status indicator (connecting, listening, processing, done)
 * - Transcript text (interim in gray, final in black)
 * - Error messages when something goes wrong
 *
 * @example
 * ```tsx
 * // In the floating window entry point
 * ReactDOM.createRoot(document.getElementById('root')!).render(
 *   <FloatingWindow />
 * );
 * ```
 */
export function FloatingWindow(): ReactNode {
  const { status, result, error } = useASRStatus();
  const [answer, setAnswer] = useState<AskResult | null>(null);
  useEffect(() => floatingApi.floatingWindow.onAnswer(setAnswer), []);
  useEffect(() => { if (status === 'connecting') setAnswer(null); }, [status]);
  const [mode, setMode] = useState<InputMode>('dictation');
  useEffect(() => floatingApi.floatingWindow.onMode(setMode), []);

  // Determine what to show based on status
  // FIX: Show transcript during listening state for real-time streaming display
  const hasTranscriptText =
    Boolean(result?.text) &&
    (status === 'listening' || status === 'processing' || status === 'done');

  // Always show status indicator (status bar at top)
  const showStatusIndicator = true;

  return (
    <div className="floating-window">
      <div className="floating-window__content">
        {/* Status indicator - always visible */}
        <div className="floating-window__status">
          {showStatusIndicator && <StatusIndicator status={status} />}
          {mode === 'ask' && <span className="floating-window__mode">問你的過去</span>}
          {mode === 'command' && <span className="floating-window__mode">指令模式</span>}
        </div>

        {/* Transcript display - show during listening, processing, and done */}
        {hasTranscriptText && result && (
          <TranscriptDisplay answer={mode === 'ask' && answer !== null && status === 'done'} text={result.text} interim={!result.isFinal} />
        )}

        {mode === 'ask' && answer && status === 'done' && <p className="floating-window__sources">依據 {answer.sources.length} 筆紀錄</p>}

        {/* Error display */}
        {error && <ErrorDisplay message={error} />}
      </div>
    </div>
  );
}
