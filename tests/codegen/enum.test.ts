import { describe, it, expect } from 'vitest';
import { generateWiringFromString } from '../helpers';

const withEnum = (enumDef: string, methods = 'GetValue() -> string') => `module test.enum

validator Always = AND(
    is_main_frame is true
)

${enumDef}

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface TestInterface {
    ${methods}
}`;

describe('Enum codegen', () => {
  describe('basic generation', () => {
    it('generates enum with explicit values', async () => {
      const schema = withEnum(`
enum Status {
    Active = "active"
    Inactive = "inactive"
    Pending = "pending"
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('export enum Status');
      expect(wiring.common.internal).toContain('Active = "active"');
      expect(wiring.common.internal).toContain('Inactive = "inactive"');
      expect(wiring.common.internal).toContain('Pending = "pending"');
    });

    it('generates enum with implicit values', async () => {
      const schema = withEnum(`
enum Color {
    Red
    Green
    Blue
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('export enum Color');
      expect(wiring.common.internal).toContain('Red = "Red"');
      expect(wiring.common.internal).toContain('Green = "Green"');
      expect(wiring.common.internal).toContain('Blue = "Blue"');
    });

    it('generates mixed explicit and implicit values', async () => {
      const schema = withEnum(`
enum Platform {
    MacOS = "darwin"
    Windows
    Linux
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('MacOS = "darwin"');
      expect(wiring.common.internal).toContain('Windows = "Windows"');
      expect(wiring.common.internal).toContain('Linux = "Linux"');
    });
  });

  describe('validator generation', () => {
    it('generates enum validator function', async () => {
      const schema = withEnum(`
enum Status {
    Active = "active"
    Inactive = "inactive"
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('$eipc_validator$_Status');
    });

    it('validator checks against enum values', async () => {
      const schema = withEnum(`
enum Status {
    Active = "active"
    Inactive = "inactive"
}`);
      const wiring = await generateWiringFromString(schema);
      // Should use a Set or array of valid values
      expect(wiring.commonRuntime.internal).toContain('active');
      expect(wiring.commonRuntime.internal).toContain('inactive');
    });
  });

  describe('usage in methods', () => {
    it('validates enum in method argument', async () => {
      const schema = withEnum(
        `enum Status {
    Active = "active"
    Inactive = "inactive"
}`,
        'SetStatus(status: Status) -> string'
      );
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('$eipc_validator$_Status');
    });

    it('validates enum in return type', async () => {
      const schema = withEnum(
        `enum Status {
    Active = "active"
    Inactive = "inactive"
}`,
        'GetStatus() -> Status'
      );
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('$eipc_validator$_Status(result)');
    });
  });

  describe('exports', () => {
    it('exports enum type', async () => {
      const schema = withEnum(`
enum MyEnum {
    Value1 = "v1"
    Value2 = "v2"
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('export enum MyEnum');
    });
  });
});
