import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // @wordwars/shared is consumed as TypeScript source, so it must be bundled
  // rather than left as an unresolvable runtime import.
  noExternal: ['@wordwars/shared'],
});
