import { describe, it, expect } from 'vitest';
import { generateWiringFromString } from '../helpers';

const withValidator = (validator: string, methods = 'GetValue() -> string') => `module test.validator

${validator}

[RendererAPI]
[Validator=TestValidator]
[ContextBridge]
interface TestInterface {
    ${methods}
}`;

describe('Validator codegen', () => {
  describe('AND logic', () => {
    it('generates AND with single condition', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    is_main_frame is true
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('event.senderFrame?.parent === null');
    });

    it('generates AND with multiple conditions', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    is_main_frame is true
    is_packaged is false
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('event.senderFrame?.parent === null');
      expect(wiring.browser.internal).toContain('$$app$$.isPackaged');
    });
  });

  describe('OR logic', () => {
    it('generates OR with multiple conditions', async () => {
      const schema = withValidator(`
validator TestValidator = OR(
    is_main_frame is true
    is_packaged is true
)`);
      const wiring = await generateWiringFromString(schema);
      // OR should have || operator
      expect(wiring.browser.internal).toContain('||');
    });
  });

  describe('nested logic', () => {
    it('generates nested AND within OR', async () => {
      const schema = withValidator(`
validator TestValidator = OR(
    AND(
        is_main_frame is true
        is_packaged is false
    )
    is_packaged is true
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('&&');
      expect(wiring.browser.internal).toContain('||');
    });

    it('generates nested OR within AND', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    is_main_frame is true
    OR(
        is_packaged is true
        is_packaged is false
    )
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('&&');
      expect(wiring.browser.internal).toContain('||');
    });
  });

  describe('string variables', () => {
    it('generates origin comparison', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    origin is "https://example.com"
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('url.origin');
      expect(wiring.browser.internal).toContain('"https://example.com"');
    });

    it('generates protocol comparison', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    protocol is "https"
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('url.protocol');
      expect(wiring.browser.internal).toContain('"https"');
    });

    it('generates hostname comparison', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    hostname is "localhost"
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('url.hostname');
      expect(wiring.browser.internal).toContain('"localhost"');
    });

    it('generates href comparison', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    href is "https://example.com/path"
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('url.href');
    });
  });

  describe('boolean variables', () => {
    it('generates is_main_frame true check', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    is_main_frame is true
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('event.senderFrame?.parent === null');
    });

    it('generates is_main_frame false check', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    is_main_frame is false
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('event.senderFrame?.parent === null');
      expect(wiring.browser.internal).toContain('=== false');
    });

    it('generates is_packaged check', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    is_packaged is true
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('$$app$$.isPackaged');
    });
  });

  describe('dynamic_global', () => {
    it('generates dynamic global check in browser', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    dynamic_global(myGlobalFlag)
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('globalThis');
      expect(wiring.browser.internal).toContain('myGlobalFlag');
    });

    it('renderer side always returns true for dynamic_global', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    dynamic_global(myGlobalFlag)
)`);
      const wiring = await generateWiringFromString(schema);
      // In preload, dynamic_global should be true (validation happens in browser)
      expect(wiring.preload.internal).toContain('true');
    });
  });

  describe('environment-dependent validators', () => {
    it('generates production and development variants', async () => {
      // Need to include 'test' since NODE_ENV=test when running vitest
      const schema = withValidator(`
validator TestValidator = {
    production: AND(
        is_packaged is true
    )
    development: AND(
        is_packaged is false
    )
    test: AND(
        is_packaged is false
    )
}`);
      const wiring = await generateWiringFromString(schema);
      // Environment-dependent validators use is_packaged check
      expect(wiring.browser.internal).toContain('$$app$$.isPackaged');
    });
  });

  describe('error cases', () => {
    it('rejects unsupported variable', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    unsupported_var is true
)`);
      await expect(generateWiringFromString(schema)).rejects.toThrow();
    });

    it('rejects type mismatch - boolean variable with string value', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    is_main_frame is "true"
)`);
      await expect(generateWiringFromString(schema)).rejects.toThrow('type');
    });

    it('rejects type mismatch - string variable with boolean value', async () => {
      const schema = withValidator(`
validator TestValidator = AND(
    origin is true
)`);
      await expect(generateWiringFromString(schema)).rejects.toThrow('type');
    });
  });

  // Note: startsWith is in the grammar but not implemented in validator wiring yet
  // When implemented, add test here
});
