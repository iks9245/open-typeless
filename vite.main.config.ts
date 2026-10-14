import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        // Native modules that should not be bundled
        'uiohook-napi',
        '@xitanggg/node-insert-text',
        'better-sqlite3',
        // ws and its optional native dependencies
        'ws',
        'bufferutil',
        'utf-8-validate',
      ],
    },
  },
});
