import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchTestApp, closeTestApp, TestApp } from './utils';

let app: TestApp;
let electronApp: ElectronApplication;
let page: Page;

test.beforeEach(async ({}, testInfo) => {
  const useSandbox = testInfo.project.name === 'sandbox-on';
  app = await launchTestApp({ sandbox: useSandbox });
  electronApp = app.electronApp;
  page = app.page;
});

test.afterEach(async () => {
  await closeTestApp(app);
});

test.describe('IPC Store', () => {
  test('getState returns initial value', async () => {
    const result = await page.evaluate(() => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return api?.counterStore?.getState();
    });
    expect(result).toBe(0);
  });

  test('getStateSync returns initial value', async () => {
    const result = await page.evaluate(() => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return api?.counterStore?.getStateSync();
    });
    expect(result).toBe(0);
  });

  test('onStateChange receives updates', async () => {
    // Set up listener in renderer
    await page.evaluate(() => {
      (window as any).storeUpdates = [];
      const api = (window as any)['e2e.test']?.['TestAPI'];
      api?.counterStore?.onStateChange((value: number) => {
        (window as any).storeUpdates.push(value);
      });
    });

    // Trigger update from main process
    await electronApp.evaluate(({ app }) => {
      (global as any).updateCounter(123);
    });

    // Wait a bit for the IPC message to arrive
    await page.waitForTimeout(100);

    // Check the update was received
    const updates = await page.evaluate(() => (window as any).storeUpdates);
    expect(updates).toContain(123);
  });
});

test.describe('IPC Methods', () => {
  test('async method returns value', async () => {
    const result = await page.evaluate(() => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return api?.GetValue();
    });
    expect(result).toBe('test-value');
  });

  test('sync method returns value', async () => {
    const result = await page.evaluate(() => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return api?.GetValueSync();
    });
    expect(result).toBe(42);
  });
});

test.describe('React Hooks', () => {
  test('hook transitions from loading to ready with initial value', async () => {
    // Wait for React to render and the hook to transition to ready
    await page.waitForSelector('#state');

    // Give it a moment for the async state to settle
    await page.waitForFunction(
      () => {
        return (window as any).__STORE_STATE__?.state === 'ready';
      },
      { timeout: 5000 },
    );

    const state = await page.evaluate(() => (window as any).__STORE_STATE__);
    expect(state.state).toBe('ready');
    expect(state.result).toBe(0); // Fresh app, so initial value is 0
  });

  test('hook displays initial value in DOM', async () => {
    await page.waitForFunction(
      () => {
        return (window as any).__STORE_STATE__?.state === 'ready';
      },
      { timeout: 5000 },
    );

    const value = await page.textContent('#value');
    expect(value).toBe('0');
  });

  test('hook updates when store changes', async () => {
    const initialRenderCount = await page.evaluate(() => (window as any).__RENDER_COUNT__);

    // Trigger update from main process
    await electronApp.evaluate(() => {
      (global as any).updateCounter(999);
    });

    // Wait for the update to propagate
    await page.waitForFunction(
      () => {
        return (window as any).__STORE_STATE__?.result === 999;
      },
      { timeout: 5000 },
    );

    const state = await page.evaluate(() => (window as any).__STORE_STATE__);
    expect(state.state).toBe('ready');
    expect(state.result).toBe(999);

    // Verify the component re-rendered
    const newRenderCount = await page.evaluate(() => (window as any).__RENDER_COUNT__);
    expect(newRenderCount).toBeGreaterThan(initialRenderCount);
  });

  test('hook receives multiple updates', async () => {
    // Send multiple updates
    await electronApp.evaluate(() => {
      (global as any).updateCounter(100);
    });
    await page.waitForFunction(() => (window as any).__STORE_STATE__?.result === 100);

    await electronApp.evaluate(() => {
      (global as any).updateCounter(200);
    });
    await page.waitForFunction(() => (window as any).__STORE_STATE__?.result === 200);

    await electronApp.evaluate(() => {
      (global as any).updateCounter(300);
    });
    await page.waitForFunction(() => (window as any).__STORE_STATE__?.result === 300);

    const state = await page.evaluate(() => (window as any).__STORE_STATE__);
    expect(state.result).toBe(300);
  });
});
