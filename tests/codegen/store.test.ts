import { describe, it, expect } from 'vitest';
import { generateWiringFromString } from '../helpers';

const baseSchema = (methods: string) => {
  // Trim leading whitespace from methods to match expected indentation
  const trimmedMethods = methods.trim().split('\n').map(line => `    ${line.trim()}`).join('\n');
  return `module teststore

validator Always = AND(
    is_main_frame is true
)

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface TestInterface {
${trimmedMethods}
}`;
};

describe('Store codegen', () => {
  describe('validation', () => {
    it('rejects stores with arguments', async () => {
      const schema = baseSchema(`
    [Store]
    myStore(arg: string) -> string
`);
      await expect(generateWiringFromString(schema)).rejects.toThrow(
        'tagged with [Store] but has arguments'
      );
    });

    it('rejects stores without return type', async () => {
      const schema = baseSchema(`
    [Store]
    myStore()
`);
      await expect(generateWiringFromString(schema)).rejects.toThrow(
        'tagged with [Store] but has no return type'
      );
    });

    it('rejects stores combined with other tags', async () => {
      const schema = baseSchema(`
    [Store]
    [Sync]
    myStore() -> string
`);
      await expect(generateWiringFromString(schema)).rejects.toThrow(
        'tagged with [Store] but is also tagged with incompatible tags'
      );
    });
  });

  describe('browser code generation', () => {
    it('generates getInitialState in impl interface', async () => {
      const schema = baseSchema(`
    [Store]
    counter() -> number
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain(
        'getInitialCounterState(): Promise<number> | number;'
      );
    });

    it('generates updateStore in dispatcher', async () => {
      const schema = baseSchema(`
    [Store]
    counter() -> number
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('updateCounterStore(state: number): void');
    });

    it('generates getState handler', async () => {
      const schema = baseSchema(`
    [Store]
    counter() -> number
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('_$store$_getState');
      expect(wiring.browser.internal).toContain('impl.getInitialCounterState()');
    });

    it('generates getStateSync handler with try/catch', async () => {
      const schema = baseSchema(`
    [Store]
    counter() -> number
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('_$store$_getStateSync');
      expect(wiring.browser.internal).toContain('try {');
      expect(wiring.browser.internal).toContain('event.returnValue = { result }');
      expect(wiring.browser.internal).toContain('event.returnValue = { error:');
    });
  });

  describe('preload code generation', () => {
    it('generates store object with all methods', async () => {
      const schema = baseSchema(`
    [Store]
    counter() -> number
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.preload.internal).toContain('counterStore: {');
      expect(wiring.preload.internal).toContain('getState(): Promise<number>');
      expect(wiring.preload.internal).toContain('getStateSync(): number');
      expect(wiring.preload.internal).toContain('onStateChange(fn: (newState: number) => void)');
    });

    it('generates error handling for sync calls', async () => {
      const schema = baseSchema(`
    [Store]
    counter() -> number
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.preload.internal).toContain('if (response.error) throw new Error(response.error)');
      expect(wiring.preload.internal).toContain('return response.result');
    });
  });

  describe('renderer interface', () => {
    it('generates IPCStore type in renderer interface', async () => {
      const schema = baseSchema(`
    [Store]
    counter() -> number
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('counterStore: IPCStore<number>');
    });

    it('handles nullable store types', async () => {
      const schema = baseSchema(`
    [Store]
    maybeValue() -> string?
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('IPCStore<string | null>');
      expect(wiring.common.internal).toContain('getInitialMaybeValueState(): Promise<string | null> | string | null;');
    });
  });

  describe('hooks generation', () => {
    it('generates React hook for store', async () => {
      const schema = baseSchema(`
    [Store]
    counter() -> number
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.rendererHooks.internal).toContain('export function useCounterStore()');
      expect(wiring.rendererHooks.internal).toContain("import { useState, useEffect } from 'react'");
    });

    it('generates state type with all variants', async () => {
      const schema = baseSchema(`
    [Store]
    counter() -> number
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.rendererHooks.internal).toContain("{ state: 'missing' }");
      expect(wiring.rendererHooks.internal).toContain("{ state: 'loading' }");
      expect(wiring.rendererHooks.internal).toContain("{ state: 'ready'; result: number }");
      expect(wiring.rendererHooks.internal).toContain("{ state: 'error'; error: Error }");
    });

    it('exports hook and state type', async () => {
      const schema = baseSchema(`
    [Store]
    counter() -> number
`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.rendererHooks.external).toContain('useCounterStore');
      expect(wiring.rendererHooks.external).toContain('CounterStoreState');
    });
  });
});
