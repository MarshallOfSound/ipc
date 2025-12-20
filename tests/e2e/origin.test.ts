import { test, expect } from '@playwright/test';
import { launchTestApp, closeTestApp, TestApp } from './utils';

// These tests verify origin validation works correctly
// They use separate Electron app launches with different initial URLs

test.describe('Origin Validation', () => {
  test('OriginRestrictedAPI is NOT available from file:// origin', async () => {
    const app = await launchTestApp({ sandbox: false, loadUrl: 'file' });

    try {
      // The OriginRestrictedAPI should NOT be available since we're loading from file://
      const result = await app.page.evaluate(() => {
        const api = (window as any)['e2e.test']?.['OriginRestrictedAPI'];
        return { available: api !== undefined };
      });

      // Should NOT be available from file:// origin
      expect(result.available).toBe(false);
    } finally {
      await closeTestApp(app);
    }
  });

  test('OriginRestrictedAPI IS available from app://test origin', async () => {
    const app = await launchTestApp({ sandbox: false, loadUrl: 'app://test' });

    try {
      // Verify we're on the right origin
      const origin = await app.page.evaluate(() => window.location.origin);
      expect(origin).toBe('app://test');

      // The OriginRestrictedAPI SHOULD be available since we're loading from app://test
      const result = await app.page.evaluate(async () => {
        const api = (window as any)['e2e.test']?.['OriginRestrictedAPI'];
        if (!api) return { available: false, reason: 'API not found on window' };
        if (!api.OriginRestrictedMethod) return { available: false, reason: 'Method not found on API' };
        try {
          const methodResult = await api.OriginRestrictedMethod();
          return { available: true, result: methodResult };
        } catch (e: any) {
          return { available: true, error: e.message };
        }
      });

      // Should be available from app://test origin
      expect(result.available).toBe(true);
      if (result.error) {
        throw new Error(`Method threw: ${result.error}`);
      }
      expect(result.result).toBe('origin-check-passed');
    } finally {
      await closeTestApp(app);
    }
  });

  test('OriginRestrictedAPI is NOT available from app://other origin', async () => {
    const app = await launchTestApp({ sandbox: false, loadUrl: 'app://other' });

    try {
      // The OriginRestrictedAPI should NOT be available since we're loading from app://other
      const result = await app.page.evaluate(() => {
        const api = (window as any)['e2e.test']?.['OriginRestrictedAPI'];
        return { available: api !== undefined };
      });

      // Should NOT be available from app://other origin
      expect(result.available).toBe(false);
    } finally {
      await closeTestApp(app);
    }
  });
});
