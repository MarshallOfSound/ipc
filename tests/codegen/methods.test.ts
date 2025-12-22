import { describe, it, expect } from 'vitest';
import { generateWiringFromString } from '../helpers';

const withMethods = (methods: string) => `module test.methods

validator Always = AND(
    is_main_frame is true
)

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface TestInterface {
${methods}
}`;

describe('Methods codegen', () => {
  describe('async methods', () => {
    it('generates async handler with invoke', async () => {
      const schema = withMethods('    GetValue() -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('target.ipc.handle');
      expect(wiring.preload.internal).toContain('ipcRenderer.invoke');
    });

    it('generates async method with arguments', async () => {
      const schema = withMethods('    GetUser(id: string, includeDetails: boolean) -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('arg_id');
      expect(wiring.browser.internal).toContain('arg_includeDetails');
    });

    it('validates arguments in async method', async () => {
      const schema = withMethods('    GetUser(id: string) -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain("typeof arg_id === 'string'");
    });

    it('validates return value in async method', async () => {
      const schema = withMethods('    GetValue() -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain("typeof result === 'string'");
    });

    it('handles nullable return type', async () => {
      const schema = withMethods('    GetValue() -> string?');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('result === null');
      expect(wiring.common.internal).toContain('string | null');
    });

    it('handles optional arguments', async () => {
      const schema = withMethods('    GetValue(id: string, options?: string) -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('options?: string');
    });
  });

  describe('sync methods', () => {
    it('generates sync handler with on/sendSync', async () => {
      const schema = withMethods(`    [Sync]
    GetValueSync() -> string`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('target.ipc.on');
      expect(wiring.browser.internal).toContain('event.returnValue');
      expect(wiring.preload.internal).toContain('ipcRenderer.sendSync');
    });

    it('wraps sync handler in try/catch', async () => {
      const schema = withMethods(`    [Sync]
    GetValueSync() -> string`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('try {');
      expect(wiring.browser.internal).toContain('catch (err)');
      expect(wiring.browser.internal).toContain('event.returnValue = { error:');
    });

    it('renderer throws on sync error', async () => {
      const schema = withMethods(`    [Sync]
    GetValueSync() -> string`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.preload.internal).toContain('if (response.error) throw new Error');
      expect(wiring.preload.internal).toContain('return response.result');
    });
  });

  describe('event methods', () => {
    it('generates event dispatcher in browser', async () => {
      const schema = withMethods(`    [Event]
    OnValueChanged(newValue: string)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('dispatchOnValueChanged');
      expect(wiring.browser.internal).toContain('target.send');
    });

    it('generates event listener in renderer', async () => {
      const schema = withMethods(`    [Event]
    OnValueChanged(newValue: string)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.preload.internal).toContain('onOnValueChanged');
      expect(wiring.preload.internal).toContain('ipcRenderer.on');
      expect(wiring.preload.internal).toContain('ipcRenderer.removeListener');
    });

    it('validates event arguments in dispatcher', async () => {
      const schema = withMethods(`    [Event]
    OnValueChanged(value: number)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain("typeof arg_value === 'number'");
    });

    it('events have no return type in renderer interface', async () => {
      const schema = withMethods(`    [Event]
    OnValueChanged(value: string)`);
      const wiring = await generateWiringFromString(schema);
      // Event listeners return unsubscribe function
      expect(wiring.common.internal).toContain('onOnValueChanged');
      expect(wiring.common.internal).toContain('() => void');
    });
  });

  describe('NotImplemented methods', () => {
    it('generates type but no handler', async () => {
      const schema = withMethods(`    [NotImplemented]
    FutureFeature() -> string`);
      const wiring = await generateWiringFromString(schema);
      // Should be in renderer interface
      expect(wiring.common.internal).toContain('FutureFeature');
      // Should NOT be in browser handlers
      expect(wiring.browser.internal).not.toContain('FutureFeature');
    });
  });

  describe('argument validation', () => {
    it('validates string argument', async () => {
      const schema = withMethods('    Process(value: string) -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain("typeof arg_value === 'string'");
    });

    it('validates number argument', async () => {
      const schema = withMethods('    Process(value: number) -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain("typeof arg_value === 'number'");
    });

    it('validates boolean argument', async () => {
      const schema = withMethods('    Process(value: boolean) -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain("typeof arg_value === 'boolean'");
    });

    it('validates array argument', async () => {
      const schema = withMethods('    Process(values: string[]) -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('Array.isArray');
    });

    it('validates nullable argument', async () => {
      const schema = withMethods('    Process(value: string?) -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('arg_value === null');
    });
  });

  describe('return value validation', () => {
    it('validates string return', async () => {
      const schema = withMethods('    GetValue() -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain("typeof result === 'string'");
    });

    it('validates array return', async () => {
      const schema = withMethods('    GetValues() -> string[]');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('Array.isArray(result)');
    });

    it('validates nullable return', async () => {
      const schema = withMethods('    GetValue() -> string?');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('result === null');
    });
  });

  describe('void return', () => {
    it('generates method without return validation', async () => {
      const schema = withMethods('    DoSomething(value: string)');
      const wiring = await generateWiringFromString(schema);
      // Should not have result validation
      expect(wiring.browser.internal).not.toContain('const result =');
    });
  });

  describe('interface types', () => {
    it('generates I{Name}Impl interface', async () => {
      const schema = withMethods('    GetValue() -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('export interface ITestInterfaceImpl');
    });

    it('generates I{Name}Renderer interface', async () => {
      const schema = withMethods('    GetValue() -> string');
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('export interface ITestInterfaceRenderer');
    });

    it('impl allows Promise or sync return type', async () => {
      const schema = withMethods('    GetValue() -> string');
      const wiring = await generateWiringFromString(schema);
      // Impl interface allows Promise<T> | T for flexibility
      expect(wiring.common.internal).toContain('ITestInterfaceImpl');
      expect(wiring.common.internal).toContain('GetValue');
    });

    it('renderer has Promise return type for async', async () => {
      const schema = withMethods('    GetValue() -> string');
      const wiring = await generateWiringFromString(schema);
      // Renderer interface should have Promise
      expect(wiring.common.internal).toContain('ITestInterfaceRenderer');
      expect(wiring.common.internal).toContain('Promise<string>');
    });

    it('renderer has sync return type for sync methods', async () => {
      const schema = withMethods(`    [Sync]
    GetValueSync() -> string`);
      const wiring = await generateWiringFromString(schema);
      // In renderer interface, sync method returns directly
      expect(wiring.common.internal).toContain('ITestInterfaceRenderer');
      expect(wiring.common.internal).toContain('GetValueSync(): string');
    });
  });

  describe('security requirements', () => {
    it('requires a Validator on every interface', async () => {
      const schema = `module test.security

[RendererAPI]
[ContextBridge]
interface NoValidator {
    GetValue() -> string
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('is missing a Validator');
    });

    it('requires RendererAPI tag on interface', async () => {
      const schema = `module test.security

validator Always = AND(
    is_main_frame is true
)

[Validator=Always]
[ContextBridge]
interface NoAPIType {
    GetValue() -> string
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('is missing an API type');
    });
  });
});
