import { describe, it, expect } from 'vitest';
import { generateWiringFromString } from '../helpers';

const withSubtype = (subtype: string, methods = 'GetValue() -> string') => `module test.subtype

validator Always = AND(
    is_main_frame is true
)

${subtype}

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface TestInterface {
    ${methods}
}`;

describe('SubType codegen', () => {
  describe('string constraints', () => {
    it('generates minLength validator', async () => {
      const schema = withSubtype(`
subtype ShortString = string(
    minLength: 2
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('$eipc_validator$_ShortString');
      expect(wiring.commonRuntime.internal).toContain('.length >= 2');
    });

    it('generates maxLength validator', async () => {
      const schema = withSubtype(`
subtype LimitedString = string(
    maxLength: 100
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('.length <= 100');
    });

    it('generates minLength and maxLength together', async () => {
      const schema = withSubtype(`
subtype BoundedString = string(
    minLength: 5
    maxLength: 50
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('.length >= 5');
      expect(wiring.commonRuntime.internal).toContain('.length <= 50');
    });

    it('generates startsWith validator', async () => {
      const schema = withSubtype(`
subtype HttpsUrl = string(
    startsWith: "https://"
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('.startsWith');
      expect(wiring.commonRuntime.internal).toContain('https://');
    });

    it('generates endsWith validator', async () => {
      const schema = withSubtype(`
subtype DotComDomain = string(
    endsWith: ".com"
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('.endsWith');
      expect(wiring.commonRuntime.internal).toContain('.com');
    });

    it('generates all string constraints together', async () => {
      const schema = withSubtype(`
subtype ValidUrl = string(
    minLength: 10
    maxLength: 200
    startsWith: "https://"
    endsWith: ".com"
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('.length >= 10');
      expect(wiring.commonRuntime.internal).toContain('.length <= 200');
      expect(wiring.commonRuntime.internal).toContain('.startsWith');
      expect(wiring.commonRuntime.internal).toContain('.endsWith');
    });
  });

  describe('number constraints', () => {
    it('generates minValue validator', async () => {
      const schema = withSubtype(`
subtype PositiveNumber = number(
    minValue: 0
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('$eipc_validator$_PositiveNumber');
      expect(wiring.commonRuntime.internal).toContain('>= 0');
    });

    it('generates maxValue validator', async () => {
      const schema = withSubtype(`
subtype LimitedNumber = number(
    maxValue: 100
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('<= 100');
    });

    it('generates minValue and maxValue together', async () => {
      const schema = withSubtype(`
subtype Percentage = number(
    minValue: 0
    maxValue: 100
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('>= 0');
      expect(wiring.commonRuntime.internal).toContain('<= 100');
    });

    it('handles negative values', async () => {
      const schema = withSubtype(`
subtype Temperature = number(
    minValue: -273
    maxValue: 1000
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('-273');
      expect(wiring.commonRuntime.internal).toContain('1000');
    });
  });

  describe('type checking', () => {
    it('generates typeof check for string subtype', async () => {
      const schema = withSubtype(`
subtype MyString = string(
    minLength: 1
)`);
      const wiring = await generateWiringFromString(schema);
      // Validator checks type with typeof
      expect(wiring.commonRuntime.internal).toContain("'string'");
    });

    it('generates typeof check for number subtype', async () => {
      const schema = withSubtype(`
subtype MyNumber = number(
    minValue: 0
)`);
      const wiring = await generateWiringFromString(schema);
      // Validator checks type with typeof
      expect(wiring.commonRuntime.internal).toContain("'number'");
    });
  });

  describe('chained subtypes', () => {
    it('chains subtype to another subtype', async () => {
      const schema = withSubtype(`
subtype BaseString = string(
    minLength: 1
)

subtype ExtendedString = BaseString(
    maxLength: 100
)`);
      const wiring = await generateWiringFromString(schema);
      // Both validators should be generated
      expect(wiring.commonRuntime.internal).toContain('$eipc_validator$_BaseString');
      expect(wiring.commonRuntime.internal).toContain('$eipc_validator$_ExtendedString');
      // ExtendedString should reference the parent type somehow
      // (either by calling parent validator or checking string type)
      expect(wiring.commonRuntime.internal).toContain("'string'");
    });
  });

  describe('error cases', () => {
    it('rejects minLength with non-number value', async () => {
      const schema = withSubtype(`
subtype BadString = string(
    minLength: "five"
)`);
      await expect(generateWiringFromString(schema)).rejects.toThrow();
    });

    it('rejects number constraint on string type', async () => {
      const schema = withSubtype(`
subtype BadString = string(
    minValue: 0
)`);
      await expect(generateWiringFromString(schema)).rejects.toThrow('Unsupported');
    });

    it('rejects string constraint on number type', async () => {
      const schema = withSubtype(`
subtype BadNumber = number(
    startsWith: "abc"
)`);
      await expect(generateWiringFromString(schema)).rejects.toThrow('Unsupported');
    });
  });

  describe('usage in methods', () => {
    it('validates subtype in method argument', async () => {
      const schema = withSubtype(
        `subtype Username = string(
    minLength: 3
    maxLength: 20
)`,
        'CreateUser(name: Username) -> string'
      );
      const wiring = await generateWiringFromString(schema);
      // Browser should validate the argument
      expect(wiring.browser.internal).toContain('$eipc_validator$_Username');
    });

    it('validates subtype in return type', async () => {
      const schema = withSubtype(
        `subtype UserId = string(
    minLength: 10
)`,
        'GetUserId() -> UserId'
      );
      const wiring = await generateWiringFromString(schema);
      // Browser should validate the return value
      expect(wiring.browser.internal).toContain('$eipc_validator$_UserId(result)');
    });
  });

  describe('exports', () => {
    it('exports subtype as type', async () => {
      const schema = withSubtype(`
subtype MyType = string(
    minLength: 1
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('export type MyType = string');
    });

    it('exports validator function', async () => {
      const schema = withSubtype(`
subtype MyType = string(
    minLength: 1
)`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('export function $eipc_validator$_MyType');
    });
  });
});
