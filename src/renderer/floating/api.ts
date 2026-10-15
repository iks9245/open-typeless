import type { FloatingAppApi } from '../../types/global';

// Both renderers share a TypeScript project. Narrow the global at this boundary
// so floating components can only use the API exposed by preload-floating.ts.
export const floatingApi = (window as unknown as { api: FloatingAppApi }).api;
