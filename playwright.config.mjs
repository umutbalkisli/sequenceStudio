// Uçtan uca testler: uygulama file:// üzerinden açılır (derleme adımı yok).
// Her test kendi tarayıcı bağlamında çalışır; depolama (IndexedDB/localStorage) testler arasında paylaşılmaz.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    locale: 'tr-TR',
  },
});
