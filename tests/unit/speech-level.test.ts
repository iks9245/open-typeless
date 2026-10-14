import { describe, expect, it } from 'vitest';
import { isSilent, measureSpeech, MIN_VOICED_MS, VOICED_FRAME_DBFS } from '../../src/main/services/asr/lib/speech-level';

const SAMPLE_RATE = 16000;

function pcm(durationMs: number, sample: (index: number) => number): Buffer {
  const samples = Math.round(durationMs * SAMPLE_RATE / 1000);
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(sample(i)), i * 2);
  return buffer;
}

function sine(index: number, amplitude = 4000): number {
  return amplitude * Math.sin(2 * Math.PI * 1000 * index / SAMPLE_RATE);
}

function noise(amplitude: number): Buffer {
  // Seeded LCG: every run uses the same uniformly distributed integer samples.
  let state = 0x12345678;
  return pcm(2000, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor(state / 0x100000000 * (2 * amplitude + 1)) - amplitude;
  });
}

describe('speech level', () => {
  it('treats two seconds of digital silence as silent with no voiced frames', () => {
    const level = measureSpeech(pcm(2000, () => 0));
    expect(level.voicedMs).toBe(0);
    expect(isSilent(level)).toBe(true);
  });

  it('treats uniform noise within ±50 as silent', () => {
    const level = measureSpeech(noise(50));
    expect(level.voicedMs).toBe(0);
    expect(isSilent(level)).toBe(true);
  });

  it('treats steady uniform noise just below the frame threshold as silent', () => {
    const level = measureSpeech(noise(150));
    expect(level.rmsDbfs).toBeLessThan(VOICED_FRAME_DBFS);
    expect(level.rmsDbfs).toBeGreaterThan(VOICED_FRAME_DBFS - 2);
    expect(level.voicedMs).toBe(0);
    expect(isSilent(level)).toBe(true);
  });

  it('lets louder steady noise (uniform ±300) through, erring toward transcription', () => {
    // The uncalibrated threshold prefers sending noise to whisper over dropping quiet speech
    const level = measureSpeech(noise(300));
    expect(level.rmsDbfs).toBeGreaterThan(VOICED_FRAME_DBFS);
    expect(isSilent(level)).toBe(false);
  });

  it('ignores a 60 ms tone surrounded by silence in a two-second recording', () => {
    const level = measureSpeech(pcm(2000, (i) => i >= 8000 && i < 8960 ? sine(i) : 0));
    expect(level.voicedMs).toBe(60);
    expect(isSilent(level)).toBe(true);
  });

  it('accepts a 300 ms tone surrounded by silence in a two-second recording', () => {
    const level = measureSpeech(pcm(2000, (i) => i >= 8000 && i < 12800 ? sine(i) : 0));
    expect(level.voicedMs).toBe(300);
    expect(isSilent(level)).toBe(false);
  });

  it('accepts two seconds of tone at amplitude 4000', () => {
    const level = measureSpeech(pcm(2000, (i) => sine(i)));
    expect(level.voicedMs).toBe(2000);
    expect(isSilent(level)).toBe(false);
  });

  it('accepts exactly MIN_VOICED_MS of voiced audio and rejects one frame less', () => {
    expect(isSilent(measureSpeech(pcm(MIN_VOICED_MS, (i) => sine(i))))).toBe(false);
    expect(isSilent(measureSpeech(pcm(MIN_VOICED_MS - 20, (i) => sine(i))))).toBe(true);
  });

  it('reports an empty buffer as silence at the -120 dBFS floor', () => {
    const level = measureSpeech(Buffer.alloc(0));
    expect(level).toEqual({ voicedMs: 0, peakDbfs: -120, rmsDbfs: -120 });
    expect(isSilent(level)).toBe(true);
  });

  it('ignores an unmatched trailing byte without changing the measured samples', () => {
    const even = pcm(2000, (i) => sine(i));
    expect(measureSpeech(Buffer.concat([even, Buffer.from([0xff])]))).toEqual(measureSpeech(even));
    expect(measureSpeech(Buffer.from([0xff]))).toEqual({ voicedMs: 0, peakDbfs: -120, rmsDbfs: -120 });
  });

  it('includes a partial frame in peak and RMS but never counts it as voiced', () => {
    const level = measureSpeech(pcm(10, () => 4000));
    expect(level.voicedMs).toBe(0);
    expect(level.peakDbfs).toBeCloseTo(20 * Math.log10(4000 / 32768), 6);
    expect(level.rmsDbfs).toBeCloseTo(level.peakDbfs, 6);
  });

  it('reports peak and RMS dBFS for a known sine wave', () => {
    const level = measureSpeech(pcm(2000, (i) => sine(i, 16384)));
    expect(level.peakDbfs).toBeCloseTo(20 * Math.log10(16384 / 32768), 5);
    // Quantizing the sine to int16 introduces a small RMS error.
    expect(level.rmsDbfs).toBeCloseTo(20 * Math.log10(16384 / Math.sqrt(2) / 32768), 3);
  });

  it('floors peak and RMS for zero samples at -120 dBFS', () => {
    expect(measureSpeech(pcm(20, () => 0))).toEqual({ voicedMs: 0, peakDbfs: -120, rmsDbfs: -120 });
  });
});
