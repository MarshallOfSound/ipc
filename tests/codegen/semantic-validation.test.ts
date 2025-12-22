import { describe, it, expect } from 'vitest';
import { generateWiringFromString } from '../helpers';

describe('Semantic validation', () => {
  describe('validator references', () => {
    it('rejects undefined validator reference', async () => {
      const schema = `module test

validator Defined = AND(is_main_frame is true)

[RendererAPI]
[Validator=Undefined]
[ContextBridge]
interface Foo {
    getValue() -> string
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('references validator "Undefined" which is not defined');
    });

    it('suggests available validators', async () => {
      const schema = `module test

validator MyValidator = AND(is_main_frame is true)
validator OtherValidator = AND(is_main_frame is true)

[RendererAPI]
[Validator=Typo]
[ContextBridge]
interface Foo {
    getValue() -> string
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('Available validators:');
    });
  });

  describe('type references', () => {
    it('rejects undefined type in return value', async () => {
      const schema = `module test

validator V = AND(is_main_frame is true)

[RendererAPI]
[Validator=V]
[ContextBridge]
interface Foo {
    getValue() -> UndefinedType
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('Type "UndefinedType" used in return type');
    });

    it('rejects undefined type in argument', async () => {
      const schema = `module test

validator V = AND(is_main_frame is true)

[RendererAPI]
[Validator=V]
[ContextBridge]
interface Foo {
    setValue(value: UndefinedType)
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('Type "UndefinedType" used in argument');
    });

    it('rejects undefined type in structure', async () => {
      const schema = `module test

validator V = AND(is_main_frame is true)

structure User {
    data: UndefinedType
}

[RendererAPI]
[Validator=V]
[ContextBridge]
interface Foo {
    getUser() -> User
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('Type "UndefinedType" used in property');
    });

    it('accepts defined types', async () => {
      const schema = `module test

validator V = AND(is_main_frame is true)

structure User {
    name: string
}

[RendererAPI]
[Validator=V]
[ContextBridge]
interface Foo {
    getUser() -> User
}`;
      await expect(generateWiringFromString(schema)).resolves.toBeDefined();
    });
  });

  describe('duplicate names', () => {
    it('rejects duplicate element names', async () => {
      const schema = `module test

structure User {
    name: string
}

enum User {
    Active
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('Duplicate definition of "User"');
    });

    it('rejects duplicate method names', async () => {
      const schema = `module test

validator V = AND(is_main_frame is true)

[RendererAPI]
[Validator=V]
[ContextBridge]
interface Foo {
    getValue() -> string
    getValue() -> number
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('duplicate method "getValue"');
    });

    it('rejects duplicate structure property names', async () => {
      const schema = `module test

validator V = AND(is_main_frame is true)

structure User {
    name: string
    name: number
}

[RendererAPI]
[Validator=V]
[ContextBridge]
interface Foo {
    getUser() -> User
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('duplicate property "name"');
    });

    it('rejects duplicate enum option names', async () => {
      const schema = `module test

enum Status {
    Active
    Active
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('duplicate option name "Active"');
    });

    it('rejects duplicate enum option values', async () => {
      const schema = `module test

enum Status {
    Active = "on"
    Available = "on"
}`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('duplicate value "on"');
    });
  });

  describe('subtype validation', () => {
    it('rejects undefined subtype parent', async () => {
      const schema = `module test

subtype MyId = UndefinedBase(minLength: 1)`;
      await expect(generateWiringFromString(schema)).rejects.toThrow('extends "UndefinedBase" which is not defined');
    });

    it('accepts valid subtype parent', async () => {
      const schema = `module test

validator V = AND(is_main_frame is true)

subtype MyId = string(minLength: 1)

[RendererAPI]
[Validator=V]
[ContextBridge]
interface Foo {
    getId() -> MyId
}`;
      await expect(generateWiringFromString(schema)).resolves.toBeDefined();
    });

    it('accepts subtype extending another subtype', async () => {
      const schema = `module test

validator V = AND(is_main_frame is true)

subtype BaseId = string(minLength: 1)
subtype UserId = BaseId(maxLength: 50)

[RendererAPI]
[Validator=V]
[ContextBridge]
interface Foo {
    getId() -> UserId
}`;
      await expect(generateWiringFromString(schema)).resolves.toBeDefined();
    });
  });

  describe('multiple errors', () => {
    it('reports all validation errors at once', async () => {
      const schema = `module test

validator V = AND(is_main_frame is true)

[RendererAPI]
[Validator=V]
[ContextBridge]
interface Foo {
    getValue() -> UndefinedType
    getValue() -> string
}`;
      try {
        await generateWiringFromString(schema);
        expect.fail('Should have thrown');
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toContain('UndefinedType');
        expect(message).toContain('duplicate method');
      }
    });
  });
});
