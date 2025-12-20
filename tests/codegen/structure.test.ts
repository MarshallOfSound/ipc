import { describe, it, expect } from 'vitest';
import { generateWiringFromString } from '../helpers';

const withStructure = (structDef: string, methods = 'GetValue() -> string') => `module test.structure

validator Always = AND(
    is_main_frame is true
)

${structDef}

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface TestInterface {
    ${methods}
}`;

describe('Structure codegen', () => {
  describe('basic generation', () => {
    it('generates interface with primitive properties', async () => {
      const schema = withStructure(`
structure User {
    name: string
    age: number
    active: boolean
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('export interface User');
      expect(wiring.common.internal).toContain('name: string');
      expect(wiring.common.internal).toContain('age: number');
      expect(wiring.common.internal).toContain('active: boolean');
    });

    it('generates interface with optional properties', async () => {
      const schema = withStructure(`
structure User {
    name: string
    nickname?: string
    age?: number
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('name: string');
      expect(wiring.common.internal).toContain('nickname?: string');
      expect(wiring.common.internal).toContain('age?: number');
    });

    it('generates interface with nullable properties', async () => {
      const schema = withStructure(`
structure User {
    name: string
    middleName: string?
}`);
      const wiring = await generateWiringFromString(schema);
      // Nullable uses (type) | null format
      expect(wiring.common.internal).toContain('middleName: (string) | null');
    });

    it('generates interface with array properties', async () => {
      const schema = withStructure(`
structure User {
    tags: string[]
    scores: number[]
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('tags: string[]');
      expect(wiring.common.internal).toContain('scores: number[]');
    });
  });

  describe('nested structures', () => {
    it('generates inline nested structure', async () => {
      const schema = withStructure(`
structure User {
    name: string
    address: {
        street: string
        city: string
        zip: string
    }
}`);
      const wiring = await generateWiringFromString(schema);
      // Should generate a separate interface for the nested structure
      expect(wiring.common.internal).toContain('street: string');
      expect(wiring.common.internal).toContain('city: string');
    });

    it('generates deeply nested structure', async () => {
      const schema = withStructure(`
structure Company {
    name: string
    headquarters: {
        address: {
            street: string
            city: string
        }
        phone: string
    }
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('street: string');
      expect(wiring.common.internal).toContain('phone: string');
    });
  });

  describe('structure references', () => {
    it('references another structure', async () => {
      const schema = withStructure(`
structure Address {
    street: string
    city: string
}

structure User {
    name: string
    address: Address
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('address: Address');
    });

    it('references enum in structure', async () => {
      const schema = withStructure(`
enum Status {
    Active = "active"
    Inactive = "inactive"
}

structure User {
    name: string
    status: Status
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('status: Status');
    });
  });

  describe('validator generation', () => {
    it('generates structure validator', async () => {
      const schema = withStructure(`
structure User {
    name: string
    age: number
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('$eipc_validator$_User');
    });

    it('validator checks property types', async () => {
      const schema = withStructure(`
structure User {
    name: string
    age: number
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain("typeof");
      expect(wiring.commonRuntime.internal).toContain("'string'");
      expect(wiring.commonRuntime.internal).toContain("'number'");
    });

    it('validator handles optional properties', async () => {
      const schema = withStructure(`
structure User {
    name: string
    nickname?: string
}`);
      const wiring = await generateWiringFromString(schema);
      // Optional should allow undefined
      expect(wiring.commonRuntime.internal).toContain('undefined');
    });

    it('validator handles nullable properties', async () => {
      const schema = withStructure(`
structure User {
    name: string
    middleName: string?
}`);
      const wiring = await generateWiringFromString(schema);
      // Nullable should allow null
      expect(wiring.commonRuntime.internal).toContain('null');
    });
  });

  describe('usage in methods', () => {
    it('validates structure in method argument', async () => {
      const schema = withStructure(
        `structure UserInput {
    name: string
    email: string
}`,
        'CreateUser(input: UserInput) -> string'
      );
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('$eipc_validator$_UserInput');
    });

    it('validates structure in return type', async () => {
      const schema = withStructure(
        `structure User {
    id: string
    name: string
}`,
        'GetUser() -> User'
      );
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('$eipc_validator$_User(result)');
    });
  });

  describe('exports', () => {
    it('exports structure interface', async () => {
      const schema = withStructure(`
structure MyStruct {
    value: string
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('export interface MyStruct');
    });

    it('exports validator function', async () => {
      const schema = withStructure(`
structure MyStruct {
    value: string
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('export function $eipc_validator$_MyStruct');
    });
  });
});
