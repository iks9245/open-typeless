/**
 * Transcript Display Component.
 * Displays transcribed text with different styles for interim and final results.
 * Measures content height and notifies main process for window adaptation.
 */

import { floatingApi } from '../../../../floating/api';
import { useEffect, useRef, type ReactNode } from 'react';

interface TranscriptDisplayProps {
  /** Transcribed text to display */
  text?: string;
  answer?: boolean;
  /** Whether this is an interim (not final) result */
  interim?: boolean;
}

/**
 * Displays transcription text with visual distinction for interim vs final results.
 * Also measures scrollHeight and notifies the main process to adapt window height.
 *
 * @example
 * ```tsx
 * // Interim result (gray text)
 * <TranscriptDisplay text="Hello wor" interim={true} />
 *
 * // Final result (black text)
 * <TranscriptDisplay text="Hello world" interim={false} />
 * ```
 */
export function TranscriptDisplay({ text, interim = false, answer = false }: TranscriptDisplayProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure content height, notify main process, and auto-scroll to bottom
  useEffect(() => {
    if (!containerRef.current || !text) {
      return;
    }

    // Use requestAnimationFrame to ensure DOM has rendered
    requestAnimationFrame(() => {
      if (containerRef.current) {
        const container = containerRef.current;
        const scrollHeight = container.scrollHeight;

        // Notify main process about content height for window resizing
        floatingApi.floatingWindow.setContentHeight(scrollHeight + (answer ? 20 : 0));

        // Auto-scroll to bottom to show latest transcription text
        // This ensures the most recent content is always visible
        container.scrollTop = answer ? 0 : scrollHeight;
      }
    });
  }, [text, answer]);

  // Don't render if no text
  if (!text) {
    return null;
  }

  const className = interim
    ? 'transcript-text transcript-text--interim'
    : 'transcript-text transcript-text--final';

  return (
    <div ref={containerRef} className={className}>
      {text}
    </div>
  );
}
