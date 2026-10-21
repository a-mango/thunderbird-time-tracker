import { defineConfig } from 'vitest/config';

// Time math is tested in a zone with DST; workers inherit this before any Date is created.
process.env.TZ = 'Europe/Berlin';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js'],
    env: { TZ: 'Europe/Berlin' },
    coverage: {
      include: ['src/**/*.js'],
      reporter: ['text', 'text-summary', 'html'],
      thresholds: {
        'src/lib/**': { lines: 90 },
        'src/db/**': { lines: 90 },
      },
    },
  },
});
