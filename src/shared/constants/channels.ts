/**
 * IPC channel constants.
 * Used by both main process and renderer process for communication.
 */

export const IPC_CHANNELS = {
  MEMORY: { ASK: 'memory:ask', STATUS: 'memory:status', REINDEX: 'memory:reindex', HISTORY: 'memory:history', ANSWERED: 'ask:answered' },
  SYSTEM: {
    GET_LOGIN_ITEM: 'system:get-login-item',
    SET_LOGIN_ITEM: 'system:set-login-item',
  },
  ASR: {
    /** Send audio data (Renderer -> Main) */
    SEND_AUDIO: 'asr:send-audio',
    /** ASR result (Main -> Renderer) */
    RESULT: 'asr:result',
    /** ASR status change (Main -> Renderer) */
    STATUS: 'asr:status',
    /** ASR error (Main -> Renderer) */
    ERROR: 'asr:error',
  },
  FLOATING_WINDOW: {
    MODE: 'floating-window:mode',
    ANSWER: 'floating-window:answer',
    /** Set content height for adaptive window sizing (Renderer -> Main) */
    SET_CONTENT_HEIGHT: 'floating-window:set-content-height',
  },
  HISTORY: {
    /** List transcription history (Renderer -> Main) */
    LIST: 'history:list',
    /** Get a transcription (Renderer -> Main) */
    GET: 'history:get',
    /** Delete a transcription (Renderer -> Main) */
    DELETE: 'history:delete',
    /** Clear transcription history (Renderer -> Main) */
    CLEAR: 'history:clear',
    /** History change (Main -> Renderer) */
    CHANGED: 'history:changed',
  },
  SETTINGS: {
    /** Get application settings (Renderer -> Main) */
    GET: 'settings:get',
    /** Update application settings (Renderer -> Main) */
    UPDATE: 'settings:update',
    /** Settings change (Main -> Renderer) */
    CHANGED: 'settings:changed',
  },
  WHISPER_SERVER: {
    /** Read the local whisper.cpp server status (Renderer -> Main) */
    STATUS: 'whisper-server:status',
  },
  REPORT: { GET: 'report:get', COMMENT: 'report:comment' },
  POLISH: {
    /** Read the local oMLX availability and models (Renderer -> Main) */
    STATUS: 'polish:status',
  },
} as const;
