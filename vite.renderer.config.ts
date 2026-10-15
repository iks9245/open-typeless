import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { contentSecurityPolicy } from './vite.csp';

// https://vitejs.dev/config
export default defineConfig({ plugins: [react(), contentSecurityPolicy()] });
