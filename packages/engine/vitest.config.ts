import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types.ts'],
      /*
       * The engine is the one place in this codebase that genuinely earns a
       * hard coverage bar (plan §10). A wrong branch here does not crash — it
       * silently desyncs two players or quietly makes a mechanic inert, which
       * is exactly what happened to the tempo bonus before it was simulated.
       */
      thresholds: {
        statements: 100,
        branches: 95,
        functions: 100,
        lines: 100,
      },
    },
  },
});
