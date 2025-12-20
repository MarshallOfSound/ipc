import { describe, it, expect } from 'vitest';
import { parseEipc, formatParseError } from '../../src/language/parser.js';

describe('Parser error messages', () => {
  describe('module declaration', () => {
    it('missing module declaration', async () => {
      const schema = `
validator Test = AND(
    is_main_frame is true
)`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Missing module declaration:', result.errors[0].message);
      expect(result.errors[0].message).toContain("'module'");
    });

    it('module without name', async () => {
      const schema = `module`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Module without name:', result.errors[0].message);
    });

    it('module with invalid name (starts with number)', async () => {
      const schema = `module 123invalid`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Module with invalid name:', result.errors[0].message);
    });
  });

  describe('validator errors', () => {
    it('validator missing equals sign', async () => {
      const schema = `module test
validator Test AND(
    is_main_frame is true
)`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Validator missing equals:', result.errors[0].message);
    });

    it('validator with unclosed parenthesis', async () => {
      const schema = `module test
validator Test = AND(
    is_main_frame is true
`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Validator unclosed paren:', result.errors[0].message);
    });

    it('validator with unknown condition variable', async () => {
      const schema = `module test
validator Test = AND(
    unknown_variable is true
)`;
      const result = await parseEipc(schema, 'test.eipc');
      // This parses successfully but fails at wiring time
      // The parser accepts any ID as a condition variable
      expect(result.errors.length).toBe(0);
    });

    it('validator with invalid boolean value', async () => {
      const schema = `module test
validator Test = AND(
    is_main_frame is yes
)`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Validator invalid boolean:', result.errors[0].message);
    });

    it('validator missing condition', async () => {
      const schema = `module test
validator Test = AND()`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Validator missing condition:', result.errors[0].message);
    });
  });

  describe('enum errors', () => {
    it('enum without braces', async () => {
      const schema = `module test
enum Status
    Active
    Inactive`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Enum without braces:', result.errors[0].message);
    });

    it('enum with unclosed brace', async () => {
      const schema = `module test
enum Status {
    Active
    Inactive`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Enum unclosed brace:', result.errors[0].message);
    });

    it('enum with invalid value type', async () => {
      const schema = `module test
enum Status {
    Active = 123
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Enum invalid value type:', result.errors[0].message);
    });
  });

  describe('structure errors', () => {
    it('structure without braces', async () => {
      const schema = `module test
structure User
    name: string`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Structure without braces:', result.errors[0].message);
    });

    it('structure property missing type', async () => {
      const schema = `module test
structure User {
    name:
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Structure property missing type:', result.errors[0].message);
    });

    it('structure property missing colon', async () => {
      const schema = `module test
structure User {
    name string
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Structure property missing colon:', result.errors[0].message);
    });

    it('structure with invalid nested structure', async () => {
      const schema = `module test
structure User {
    metadata: {
        createdAt: number
    // missing closing brace
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Structure invalid nested:', result.errors[0].message);
    });
  });

  describe('subtype errors', () => {
    it('subtype missing parent type', async () => {
      const schema = `module test
subtype Username = (
    minLength: 3
)`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Subtype missing parent:', result.errors[0].message);
    });

    it('subtype missing restriction value', async () => {
      const schema = `module test
subtype Username = string(
    minLength:
)`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Subtype missing restriction value:', result.errors[0].message);
    });

    it('subtype with empty restrictions', async () => {
      const schema = `module test
subtype Username = string()`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Subtype empty restrictions:', result.errors[0].message);
    });
  });

  describe('interface errors', () => {
    it('interface missing RendererAPI tag', async () => {
      const schema = `module test
validator V = AND(is_main_frame is true)

[Validator=V]
interface Test {
    GetValue() -> string
}`;
      const result = await parseEipc(schema, 'test.eipc');
      // This parses successfully but fails at wiring time
      expect(result.errors.length).toBe(0);
    });

    it('interface with unclosed brace', async () => {
      const schema = `module test
[RendererAPI]
[Validator=V]
interface Test {
    GetValue() -> string`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Interface unclosed brace:', result.errors[0].message);
    });

    it('method missing parentheses', async () => {
      const schema = `module test
validator V = AND(is_main_frame is true)

[RendererAPI]
[Validator=V]
interface Test {
    GetValue -> string
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Method missing parentheses:', result.errors[0].message);
    });

    it('method argument missing type', async () => {
      const schema = `module test
validator V = AND(is_main_frame is true)

[RendererAPI]
[Validator=V]
interface Test {
    GetValue(id) -> string
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Method argument missing type:', result.errors[0].message);
    });

    it('method with invalid return arrow', async () => {
      const schema = `module test
validator V = AND(is_main_frame is true)

[RendererAPI]
[Validator=V]
interface Test {
    GetValue() => string
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Method invalid return arrow:', result.errors[0].message);
    });

    it('invalid tag format', async () => {
      const schema = `module test
validator V = AND(is_main_frame is true)

[RendererAPI
[Validator=V]
interface Test {
    GetValue() -> string
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Invalid tag format:', result.errors[0].message);
    });
  });

  describe('zod_reference errors', () => {
    it('zod_reference missing import', async () => {
      const schema = `module test
zod_reference Email {
    type = "Email"
    schema = "emailSchema"
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Zod reference missing import:', result.errors[0].message);
    });

    it('zod_reference missing schema', async () => {
      const schema = `module test
zod_reference Email {
    import = "./schemas"
    type = "Email"
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Zod reference missing schema:', result.errors[0].message);
    });

    it('zod_reference with wrong order', async () => {
      const schema = `module test
zod_reference Email {
    schema = "emailSchema"
    type = "Email"
    import = "./schemas"
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Zod reference wrong order:', result.errors[0].message);
    });
  });

  describe('formatParseError', () => {
    it('formats error with line context', async () => {
      const schema = `module test

validator Test = AND(
    is_main_frame is yes
)`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);

      const error = result.errors[0];
      console.log('\nError details:');
      console.log('  line:', error.line);
      console.log('  column:', error.column);
      console.log('  endLine:', error.endLine);
      console.log('  endColumn:', error.endColumn);
      console.log('  message:', error.message);

      // Verify line/column are populated
      expect(error.line).toBe(4);
      expect(error.column).toBe(22);
      expect(typeof error.endLine).toBe('number');
      expect(typeof error.endColumn).toBe('number');

      const formatted = formatParseError(result.errors[0], 'test.eipc', schema);
      console.log('\nFormatted error:\n' + formatted);

      expect(formatted).toContain('test.eipc');
      expect(formatted).toContain('line 4');
      expect(formatted).toContain('column 22');
    });

    it('formats error for first line issue', async () => {
      const schema = `invalid start`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);

      const formatted = formatParseError(result.errors[0], 'test.eipc', schema);
      console.log('\nFormatted error (first line):\n' + formatted);

      expect(formatted).toContain('test.eipc');
    });
  });

  describe('general syntax errors', () => {
    it('completely invalid syntax', async () => {
      const schema = `@#$%^&*`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Completely invalid syntax:', result.errors[0].message);
    });

    it('random text after valid module', async () => {
      const schema = `module test
this is not valid syntax at all`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Random text after module:', result.errors[0].message);
    });

    it('empty file', async () => {
      const schema = ``;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Empty file:', result.errors[0].message);
    });

    it('only whitespace', async () => {
      const schema = `

   `;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Only whitespace:', result.errors[0].message);
    });

    it('unclosed string literal', async () => {
      const schema = `module test
enum Status {
    Active = "unclosed
}`;
      const result = await parseEipc(schema, 'test.eipc');
      expect(result.errors.length).toBeGreaterThan(0);
      console.log('Unclosed string:', result.errors[0].message);
    });
  });
});
