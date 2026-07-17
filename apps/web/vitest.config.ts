import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // The application-shell suites lazy-load most route modules. Running the
    // two files in one worker prevents CPU contention from turning normal
    // assertions into CI-only five-second timeouts.
    fileParallelism: false,
    maxWorkers: 1,
    setupFiles: './src/test/setup.ts',
  },
});
