import { describe, it, expect } from 'vitest';
import { generateWiringFromString } from '../helpers';

const withZodReference = (zodRef: string, methods = 'GetValue() -> string') => `module test.zod

validator Always = AND(
    is_main_frame is true
)

${zodRef}

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface TestInterface {
    ${methods}
}`;

describe('ZodReference codegen', () => {
  describe('basic generation', () => {
    it('generates type import', async () => {
      const schema = withZodReference(`
zod_reference UserId {
    import = "./types"
    type = "UserIdType"
    schema = "userIdSchema"
}`);
      const wiring = await generateWiringFromString(schema);
      // Should import the type
      expect(wiring.common.internal).toContain('import type { UserIdType }');
      expect(wiring.common.internal).toContain('./types');
    });

    it('generates schema import for validator', async () => {
      const schema = withZodReference(`
zod_reference UserId {
    import = "./types"
    type = "UserIdType"
    schema = "userIdSchema"
}`);
      const wiring = await generateWiringFromString(schema);
      // Should import the schema in runtime
      expect(wiring.commonRuntime.internal).toContain('userIdSchema');
    });

    it('generates validator function using safeParse', async () => {
      const schema = withZodReference(`
zod_reference UserId {
    import = "./schemas"
    type = "UserIdType"
    schema = "userIdSchema"
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('$eipc_validator$_UserId');
      expect(wiring.commonRuntime.internal).toContain('.safeParse');
      expect(wiring.commonRuntime.internal).toContain('.success');
    });
  });

  describe('multiple zod references', () => {
    it('handles multiple zod references', async () => {
      const schema = withZodReference(`
zod_reference UserId {
    import = "./types/user"
    type = "UserIdType"
    schema = "userIdSchema"
}

zod_reference Email {
    import = "./types/email"
    type = "EmailType"
    schema = "emailSchema"
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('UserId');
      expect(wiring.common.internal).toContain('Email');
      expect(wiring.commonRuntime.internal).toContain('$eipc_validator$_UserId');
      expect(wiring.commonRuntime.internal).toContain('$eipc_validator$_Email');
    });
  });

  describe('usage in methods', () => {
    it('validates zod type in method argument', async () => {
      const schema = withZodReference(
        `zod_reference UserId {
    import = "./types"
    type = "UserIdType"
    schema = "userIdSchema"
}`,
        'GetUser(id: UserId) -> string',
      );
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('$eipc_validator$_UserId');
    });

    it('validates zod type in return type', async () => {
      const schema = withZodReference(
        `zod_reference UserId {
    import = "./types"
    type = "UserIdType"
    schema = "userIdSchema"
}`,
        'CreateUser() -> UserId',
      );
      const wiring = await generateWiringFromString(schema);
      expect(wiring.browser.internal).toContain('$eipc_validator$_UserId(result)');
    });
  });

  describe('exports', () => {
    it('exports zod type', async () => {
      const schema = withZodReference(`
zod_reference CustomType {
    import = "./my-types"
    type = "MyType"
    schema = "mySchema"
}`);
      const wiring = await generateWiringFromString(schema);
      // Type should be exported (re-exported as the original type name)
      expect(wiring.common.internal).toContain('export { MyType }');
    });

    it('exports validator function', async () => {
      const schema = withZodReference(`
zod_reference CustomType {
    import = "./my-types"
    type = "MyType"
    schema = "mySchema"
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.commonRuntime.internal).toContain('export function $eipc_validator$_CustomType');
    });
  });

  describe('import paths', () => {
    it('preserves relative import paths', async () => {
      const schema = withZodReference(`
zod_reference Type1 {
    import = "../shared/types"
    type = "SharedType"
    schema = "sharedSchema"
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('../shared/types');
    });

    it('preserves absolute import paths', async () => {
      const schema = withZodReference(`
zod_reference Type1 {
    import = "@myorg/schemas"
    type = "OrgType"
    schema = "orgSchema"
}`);
      const wiring = await generateWiringFromString(schema);
      expect(wiring.common.internal).toContain('@myorg/schemas');
    });
  });
});
