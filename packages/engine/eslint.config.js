import base from '@wordwars/config/eslint';

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      /*
       * The engine must be deterministic (plan §1.1 D4). `Date.now()` and
       * `Math.random()` are the two ways that quietly stops being true, and a
       * desync between client prediction and server authority is far harder to
       * notice than a failed lint. Time is injected; randomness is derived from
       * the match seed.
       */
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Engine must be deterministic — inject time as a parameter.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Engine must be deterministic — use the seeded hash in rng.ts.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Engine must be deterministic — inject time as a parameter.',
        },
      ],
    },
  },
];
