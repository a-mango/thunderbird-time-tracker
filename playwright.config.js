import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 5173);

export default defineConfig({
  testDir: 'tests/ui',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Reduced motion turns colour transitions off, so axe never samples a half-faded colour.
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', reducedMotion: 'reduce' },
  projects: [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }],
  webServer: {
    command: `node scripts/serve.mjs --port ${port}`,
    url: `http://localhost:${port}/ui/tracker.html`,
    reuseExistingServer: !process.env.CI,
  },
});
