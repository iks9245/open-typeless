/**
 * Main window renderer process.
 * Handles automatic audio recording when ASR status changes.
 */

import { AudioRecorder } from './renderer/src/modules/asr';

console.log(
  '👋 This message is being logged by "renderer.ts", included via Vite',
);

// Audio recorder instance
let recorder: AudioRecorder | null = null;

/**
 * Initialize audio recorder with callback to send chunks to main process.
 */
function initRecorder(): AudioRecorder {
  return new AudioRecorder(
    (chunk) => {
      // Send audio chunk to main process via IPC
      window.api.asr.sendAudio(chunk);
    },
    (state) => {
      console.log('[Renderer] AudioRecorder state:', state);
    }
  );
}

/**
 * Start recording audio.
 */
async function startRecording(): Promise<void> {
  if (!recorder) {
    recorder = initRecorder();
  }

  try {
    console.log('[Renderer] Starting audio recording...');
    await recorder.start();
    console.log('[Renderer] Audio recording started');
  } catch (error) {
    console.error('[Renderer] Failed to start recording:', error);
  }
}

/**
 * Stop recording audio.
 */
function stopRecording(): void {
  if (recorder) {
    console.log('[Renderer] Stopping audio recording...');
    recorder.stop();
    console.log('[Renderer] Audio recording stopped');
  }
}

// Track current status to avoid duplicate operations
let currentStatus = 'idle';

// Listen for ASR status changes from main process
window.api.asr.onStatus((status) => {
  console.log('[Renderer] ASR status changed:', status);

  // Avoid duplicate handling
  if (status === currentStatus) return;
  currentStatus = status;

  if (status === 'listening') {
    // Start recording when ASR is listening
    startRecording();
  } else {
    // Stop recording for any other status
    stopRecording();
  }
});

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
  if (recorder) {
    recorder.destroy();
    recorder = null;
  }
});

console.log('[Renderer] Auto-recording initialized, waiting for ASR status...');

// Load the UI only after recording is initialized. Import/mount failures and
// React rendering errors must never prevent the independent ASR listener above.
void (async () => {
  try {
    const { mountMainWindow } = await import('./renderer/src/modules/main-window');
    mountMainWindow();
  } catch (error) {
    console.error('[Renderer] Failed to mount main window UI:', error);
    const root = document.getElementById('root');
    if (root) root.textContent = '介面無法載入，請重新開啟主視窗。';
  }
})();
