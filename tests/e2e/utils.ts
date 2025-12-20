import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TestApp {
  electronApp: ElectronApplication;
  page: Page;
}

/**
 * Launch the test Electron app and wait for it to be fully ready.
 * This includes waiting for:
 * 1. The first window to open
 * 2. DOM to be loaded
 * 3. The IPC APIs to be exposed on window
 */
export async function launchTestApp(options: { sandbox: boolean; useCjs?: boolean; loadUrl?: string }): Promise<TestApp> {
  const isLinuxCI = process.env.CI && process.platform === 'linux';
  const electronApp = await electron.launch({
    args: [
      path.join(__dirname, 'test-app/dist/main.js'),
      // Required for running on Linux CI (GitHub Actions)
      ...(isLinuxCI ? ['--no-sandbox', '--disable-gpu'] : []),
    ],
    env: {
      ...process.env,
      SANDBOX: options.sandbox ? 'true' : 'false',
      USE_CJS: options.useCjs ? 'true' : 'false',
      LOAD_URL: options.loadUrl,
    },
  });

  // Wait for the first window with a timeout
  const page = await electronApp.firstWindow();

  // Wait for DOM to be ready
  await page.waitForLoadState('domcontentloaded');

  // Wait for the IPC API to be exposed on window
  // This ensures the preload script has fully executed
  await page.waitForFunction(() => (window as any)['e2e.test']?.['TestAPI'] !== undefined, { timeout: 10000 });

  return { electronApp, page };
}

/**
 * Safely close the test app
 */
export async function closeTestApp(app: TestApp): Promise<void> {
  try {
    await app.electronApp.close();
  } catch (e) {
    // Ignore errors during cleanup - app may already be closed
  }
}
