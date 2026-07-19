import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      // Silence application logging in tests. Real failures are easy to miss in
      // a wall of INFO lines, and these tests deliberately trigger warnings.
      LOG_LEVEL: 'silent',
      LOG_PRETTY: 'false',
      PERSISTENCE: 'none',
    },
  },
});
