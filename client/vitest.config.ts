/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
    /**
     * Above the 5s default, for headroom rather than because anything here is
     * slow. These are jsdom tests driving real user-event interaction, and the
     * suite runs beside the server suite locally and in CI; the failures that
     * produced this were load, not behaviour. Still well short of "a hung test
     * takes ages to report".
     */
    testTimeout: 15_000,
  },
});
