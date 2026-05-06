import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest's default include picks up `**/*.{test,spec}.{ts,tsx,…}`, which
// collides with the Playwright e2e specs under `tests/e2e/*.spec.ts`.
// Scope discovery to unit tests under `src/` and explicitly exclude e2e.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
});
