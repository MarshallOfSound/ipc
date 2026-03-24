import { describe, it, expect } from 'vitest';
import { generateWiringFromString } from '../helpers';

const baseSchema = `module test.typeexports

validator Always = AND(
    is_main_frame is true
)

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface AppService {
    GetValue() -> string
}`;

const storeSchema = `module test.typeexports

validator Always = AND(
    is_main_frame is true
)

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface AppService {
    GetValue() -> string
    [Store]
    connection() -> string
}`;

describe('Type-only exports in barrel files', () => {
  describe('renderer barrel file', () => {
    it('uses export type for interface types', async () => {
      const wiring = await generateWiringFromString(baseSchema);
      expect(wiring.renderer.external).toContain('export type { IAppServiceRenderer }');
    });

    it('uses regular export for value exports', async () => {
      const wiring = await generateWiringFromString(baseSchema);
      expect(wiring.renderer.external).toContain('export { AppService }');
    });

    it('does not mix type exports in value export statement', async () => {
      const wiring = await generateWiringFromString(baseSchema);
      // The value export should not contain the interface type
      const valueExportMatch = wiring.renderer.external.match(/export \{([^}]+)\}/);
      expect(valueExportMatch).toBeTruthy();
      expect(valueExportMatch![1]).not.toContain('IAppServiceRenderer');
    });
  });

  describe('renderer-hooks barrel file', () => {
    it('uses export type for store state types', async () => {
      const wiring = await generateWiringFromString(storeSchema);
      expect(wiring.rendererHooks.external).toContain('export type { ConnectionStoreState }');
    });

    it('uses regular export for hook functions', async () => {
      const wiring = await generateWiringFromString(storeSchema);
      expect(wiring.rendererHooks.external).toContain('export { useConnectionStore }');
    });

    it('does not mix type exports in value export statement', async () => {
      const wiring = await generateWiringFromString(storeSchema);
      const valueExportMatch = wiring.rendererHooks.external.match(/export \{([^}]+)\}/);
      expect(valueExportMatch).toBeTruthy();
      expect(valueExportMatch![1]).not.toContain('StoreState');
    });
  });

  describe('browser barrel file is unaffected', () => {
    it('only has value exports', async () => {
      const wiring = await generateWiringFromString(baseSchema);
      expect(wiring.browser.external).toContain('export { AppService }');
      expect(wiring.browser.external).not.toContain('export type');
    });
  });

  describe('preload barrel file is unaffected', () => {
    it('only has value exports', async () => {
      const wiring = await generateWiringFromString(baseSchema);
      expect(wiring.preload.external).toContain('export { AppService }');
      expect(wiring.preload.external).not.toContain('export type');
    });
  });

  describe('common barrel file uses export *', () => {
    it('uses export * instead of named exports', async () => {
      const wiring = await generateWiringFromString(baseSchema);
      expect(wiring.common.external).toContain('export *');
      expect(wiring.common.external).not.toContain('export {');
    });
  });

  describe('multiple interfaces', () => {
    it('separates type and value exports across multiple interfaces', async () => {
      const schema = `module test.multi

validator Always = AND(
    is_main_frame is true
)

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface ServiceA {
    DoWork() -> string
}

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface ServiceB {
    DoOtherWork() -> number
}`;
      const wiring = await generateWiringFromString(schema);
      // Value exports should be together
      expect(wiring.renderer.external).toContain('export { ServiceA, ServiceB }');
      // Type exports should be together
      expect(wiring.renderer.external).toContain('export type { IServiceARenderer, IServiceBRenderer }');
    });
  });
});
