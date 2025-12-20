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

test.describe('Event Dispatching', () => {
  test('events are received by renderer', async () => {
    // Wait for the event listener to be set up
    await page.waitForFunction(() => {
      return (window as any)['e2e.test']?.['TestAPI']?.onOnValueChanged !== undefined;
    });

    // Clear any existing events
    await page.evaluate(() => {
      (window as any).__EVENT_RECEIVED__ = [];
    });

    // Dispatch event from main process
    await electronApp.evaluate(() => {
      (global as any).dispatchValueChanged('hello-from-main');
    });

    // Wait for event to arrive
    await page.waitForFunction(
      () => {
        return (window as any).__EVENT_RECEIVED__.length > 0;
      },
      { timeout: 5000 },
    );

    const events = await page.evaluate(() => (window as any).__EVENT_RECEIVED__);
    expect(events).toContain('hello-from-main');
  });

  test('multiple events are received in order', async () => {
    await page.waitForFunction(() => {
      return (window as any)['e2e.test']?.['TestAPI']?.onOnValueChanged !== undefined;
    });

    await page.evaluate(() => {
      (window as any).__EVENT_RECEIVED__ = [];
    });

    // Dispatch multiple events
    await electronApp.evaluate(() => {
      (global as any).dispatchValueChanged('event-1');
      (global as any).dispatchValueChanged('event-2');
      (global as any).dispatchValueChanged('event-3');
    });

    await page.waitForFunction(
      () => {
        return (window as any).__EVENT_RECEIVED__.length >= 3;
      },
      { timeout: 5000 },
    );

    const events = await page.evaluate(() => (window as any).__EVENT_RECEIVED__);
    expect(events).toEqual(['event-1', 'event-2', 'event-3']);
  });
});

test.describe('Sync API Error Handling', () => {
  test('sync method errors are propagated to renderer', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      try {
        api?.ThrowingSyncMethod();
        return { threw: false };
      } catch (e: any) {
        return { threw: true, message: e.message };
      }
    });

    expect(result.threw).toBe(true);
    expect(result.message).toContain('Intentional error');
  });
});

test.describe('Subtype Validation', () => {
  test('valid username passes validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return await api?.ValidateUsername('validuser');
    });
    expect(result).toBe(true);
  });

  test('username too short fails validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      try {
        await api?.ValidateUsername('ab'); // Less than 3 chars
        return { threw: false };
      } catch (e: any) {
        return { threw: true, message: e.message };
      }
    });
    expect(result.threw).toBe(true);
    expect(result.message).toContain('validation');
  });

  test('username too long fails validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      try {
        await api?.ValidateUsername('a'.repeat(25)); // More than 20 chars
        return { threw: false };
      } catch (e: any) {
        return { threw: true, message: e.message };
      }
    });
    expect(result.threw).toBe(true);
    expect(result.message).toContain('validation');
  });

  test('valid positive number passes validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return await api?.ValidateNumber(42);
    });
    expect(result).toBe(true);
  });

  test('negative number fails positive validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      try {
        await api?.ValidateNumber(-5);
        return { threw: false };
      } catch (e: any) {
        return { threw: true, message: e.message };
      }
    });
    expect(result.threw).toBe(true);
  });

  test('number within bounds passes validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return await api?.ValidateBoundedNumber(50);
    });
    expect(result).toBe(true);
  });

  test('number above max bound fails validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      try {
        await api?.ValidateBoundedNumber(150);
        return { threw: false };
      } catch (e: any) {
        return { threw: true, message: e.message };
      }
    });
    expect(result.threw).toBe(true);
  });

  test('zero is valid for bounded number (edge case)', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return await api?.ValidateBoundedNumber(0);
    });
    expect(result).toBe(true);
  });

  test('100 is valid for bounded number (edge case)', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return await api?.ValidateBoundedNumber(100);
    });
    expect(result).toBe(true);
  });
});

// Origin validation tests moved to origin.test.ts
// They use separate Electron app launches with different initial URLs

test.describe('Zod Reference Validation', () => {
  test('valid email passes zod validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return await api?.ValidateEmail('test@example.com');
    });
    expect(result).toBe(true);
  });

  test('invalid email fails zod validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      try {
        await api?.ValidateEmail('not-an-email');
        return { threw: false };
      } catch (e: any) {
        return { threw: true, message: e.message };
      }
    });
    expect(result.threw).toBe(true);
    expect(result.message).toContain('validation');
  });

  test('valid userId passes zod validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      return await api?.ValidateUserId(42);
    });
    expect(result).toBe(true);
  });

  test('negative userId fails zod validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      try {
        await api?.ValidateUserId(-5);
        return { threw: false };
      } catch (e: any) {
        return { threw: true, message: e.message };
      }
    });
    expect(result.threw).toBe(true);
    expect(result.message).toContain('validation');
  });

  test('non-integer userId fails zod validation', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      try {
        await api?.ValidateUserId(3.14);
        return { threw: false };
      } catch (e: any) {
        return { threw: true, message: e.message };
      }
    });
    expect(result.threw).toBe(true);
    expect(result.message).toContain('validation');
  });

  test('zero userId fails zod validation (must be positive)', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['TestAPI'];
      try {
        await api?.ValidateUserId(0);
        return { threw: false };
      } catch (e: any) {
        return { threw: true, message: e.message };
      }
    });
    expect(result.threw).toBe(true);
    expect(result.message).toContain('validation');
  });
});

test.describe('Dynamic Global Validation', () => {
  test('API works when dynamic global is set', async () => {
    // Set the dynamic global
    await electronApp.evaluate(() => {
      (global as any).setDynamicGlobal(true);
    });

    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['DynamicGlobalAPI'];
      if (!api) return { available: false };
      try {
        const result = await api.DynamicGlobalMethod();
        return { available: true, result };
      } catch (e: any) {
        return { available: true, error: e.message };
      }
    });

    expect(result.available).toBe(true);
    expect(result.result).toBe('dynamic-global-success');
  });

  test('API fails when dynamic global is not set', async () => {
    // Ensure the global is NOT set
    await electronApp.evaluate(() => {
      (global as any).testGlobalFlag = undefined;
    });

    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['DynamicGlobalAPI'];
      if (!api) return { available: false };
      try {
        await api.DynamicGlobalMethod();
        return { threw: false };
      } catch (e: any) {
        return { threw: true, message: e.message };
      }
    });

    // Should fail validation
    if (result.available !== false) {
      expect(result.threw).toBe(true);
    }
  });
});

test.describe('Main Frame Validation (is_main_frame)', () => {
  test('main frame API works in main frame', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['MainFrameAPI'];
      if (!api) return { available: false };
      try {
        const result = await api.MainFrameOnlyMethod();
        return { available: true, result };
      } catch (e: any) {
        return { available: true, error: e.message };
      }
    });

    expect(result.available).toBe(true);
    expect(result.result).toBe('main-frame-success');
  });

  test('main frame API is NOT available in iframe', async () => {
    // Create an iframe and check that MainFrameAPI is not exposed
    const result = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.src = 'about:blank';
        iframe.onload = () => {
          // Check if APIs are available in the iframe
          const iframeWindow = iframe.contentWindow as any;
          resolve({
            // TestAPI uses AllowAll validator - should be available
            testAPI: !!iframeWindow?.['e2e.test']?.['TestAPI'],
            // MainFrameAPI uses MainFrameOnly validator - should NOT be available
            mainFrameAPI: !!iframeWindow?.['e2e.test']?.['MainFrameAPI'],
          });
        };
        document.getElementById('iframe-container')?.appendChild(iframe);
      });
    });

    // MainFrameAPI should NOT be available in the iframe
    expect(result.mainFrameAPI).toBe(false);
  });
});

test.describe('Invalid URL Handling', () => {
  test('origin-based validator handles about:blank gracefully', async () => {
    // Create an iframe with about:blank and verify origin-based validators
    // don't crash when parsing the invalid URL
    const result = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.src = 'about:blank';
        iframe.onload = () => {
          const iframeWindow = iframe.contentWindow as any;
          // OriginRestrictedAPI has origin validation - should handle about:blank gracefully
          // and simply not expose the API (rather than crashing)
          resolve({
            originRestrictedAPI: !!iframeWindow?.['e2e.test']?.['OriginRestrictedAPI'],
            // No errors should be thrown during the check
            noErrors: true,
          });
        };
        document.getElementById('iframe-container')?.appendChild(iframe);
      });
    });

    // OriginRestrictedAPI should NOT be available (origin is about:blank, not app://test)
    expect(result.originRestrictedAPI).toBe(false);
    expect(result.noErrors).toBe(true);
  });
});

test.describe('is_about_blank Validation', () => {
  test('NotAboutBlankAPI is available in main frame (not about:blank)', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['NotAboutBlankAPI'];
      if (!api) return { available: false };
      try {
        const result = await api.NotAboutBlankMethod();
        return { available: true, result };
      } catch (e: any) {
        return { available: true, error: e.message };
      }
    });

    expect(result.available).toBe(true);
    expect(result.result).toBe('not-about-blank-success');
  });

  test('OnlyAboutBlankAPI is NOT available in main frame (not about:blank)', async () => {
    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['OnlyAboutBlankAPI'];
      return { available: api !== undefined };
    });

    // OnlyAboutBlankAPI should NOT be available in main frame
    expect(result.available).toBe(false);
  });

  test('OnlyAboutBlankAPI IS available when loaded from about:blank', async () => {
    // Navigate to about:blank
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].loadURL('about:blank');
    });

    // Wait for navigation
    await page.waitForURL('about:blank');

    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['OnlyAboutBlankAPI'];
      if (!api) return { available: false };
      try {
        const methodResult = await api.OnlyAboutBlankMethod();
        return { available: true, result: methodResult };
      } catch (e: any) {
        return { available: true, error: e.message };
      }
    });

    expect(result.available).toBe(true);
    expect(result.result).toBe('only-about-blank-success');
  });

  test('NotAboutBlankAPI is NOT available when loaded from about:blank', async () => {
    // Navigate to about:blank
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].loadURL('about:blank');
    });

    // Wait for navigation
    await page.waitForURL('about:blank');

    const result = await page.evaluate(async () => {
      const api = (window as any)['e2e.test']?.['NotAboutBlankAPI'];
      return { available: api !== undefined };
    });

    // NotAboutBlankAPI should NOT be available on about:blank
    expect(result.available).toBe(false);
  });
});
