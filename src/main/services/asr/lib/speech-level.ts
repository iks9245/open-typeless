/**
 * Speech level measurement for 16-bit, 16 kHz, mono PCM.
 * Used to skip transcription of silent recordings, which whisper.cpp
 * otherwise turns into phantom text such as "Thank you.".
 */

/** 20 ms frames at 16 kHz */
const FRAME_SAMPLES = 320;
const FRAME_MS = 20;

/**
 * A frame counts as voiced at or above this RMS level (about int16 RMS 104).
 * Not yet calibrated with real recordings, so it errs toward sending audio: quiet speech
 * dropped as silence would lose a dictation, while noise sent to whisper only does what
 * happened before this gate existed. The renderer captures with echo cancellation,
 * noise suppression and auto gain enabled.
 */
export const VOICED_FRAME_DBFS = -50;

/** Recordings with less voiced audio than this are treated as silence (lenient, see above) */
export const MIN_VOICED_MS = 100;

/** Lowest level reported, used instead of -Infinity for digital silence */
const FLOOR_DBFS = -120;

/**
 * Speech level of a recording.
 */
export interface SpeechLevel {
  /** Total duration of voiced frames */
  voicedMs: number;
  /** Highest absolute sample level */
  peakDbfs: number;
  /** RMS level over the whole recording */
  rmsDbfs: number;
}

const toDbfs = (amplitude: number): number =>
  amplitude <= 0 ? FLOOR_DBFS : Math.max(FLOOR_DBFS, 20 * Math.log10(amplitude / 32768));

/**
 * Measure the speech level of little-endian 16-bit PCM.
 * A trailing partial frame is included in the totals but never counted as voiced.
 */
export function measureSpeech(pcm: Buffer): SpeechLevel {
  const samples = Math.floor(pcm.length / 2);
  let peak = 0;
  let totalSquares = 0;
  let voicedFrames = 0;

  for (let frameStart = 0; frameStart < samples; frameStart += FRAME_SAMPLES) {
    const frameEnd = Math.min(frameStart + FRAME_SAMPLES, samples);
    let frameSquares = 0;

    for (let i = frameStart; i < frameEnd; i++) {
      const sample = pcm.readInt16LE(i * 2);
      const magnitude = Math.abs(sample);
      if (magnitude > peak) peak = magnitude;
      frameSquares += sample * sample;
    }

    totalSquares += frameSquares;
    if (frameEnd - frameStart === FRAME_SAMPLES &&
        toDbfs(Math.sqrt(frameSquares / FRAME_SAMPLES)) >= VOICED_FRAME_DBFS) {
      voicedFrames++;
    }
  }

  return {
    voicedMs: voicedFrames * FRAME_MS,
    peakDbfs: toDbfs(peak),
    rmsDbfs: samples === 0 ? FLOOR_DBFS : toDbfs(Math.sqrt(totalSquares / samples)),
  };
}

/**
 * Whether a recording contains too little voiced audio to transcribe.
 */
export function isSilent(level: SpeechLevel): boolean {
  return level.voicedMs < MIN_VOICED_MS;
}
