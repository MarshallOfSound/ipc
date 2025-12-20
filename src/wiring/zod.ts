import { Controller } from '../controller.js';
import type { ZodReference } from '../language/generated/ast.js';
import { validator } from './_constants.js';

// Helper to strip quotes from STRING tokens
const stripQuotes = (s: string) => s.replace(/^"|"$/g, '');

// Helper to ensure import path has .js extension for ESM compatibility
const ensureJsExtension = (importPath: string): string => {
  // Skip if it's a package import (no relative path)
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    return importPath;
  }
  // Skip if it already has an extension
  if (/\.[a-zA-Z]+$/.test(importPath)) {
    return importPath;
  }
  // Add .js extension
  return `${importPath}.js`;
};

export const wireZodReference = (zod: ZodReference, controller: Controller) => {
  const file = ensureJsExtension(stripQuotes(zod.file));
  const typeName = stripQuotes(zod.typeName);
  const schemaName = stripQuotes(zod.schemaName);

  controller.addCommonCode([`import type { ${typeName} } from "${file}";`, `export { ${typeName} };`].join('\n'));
  controller.addCommonRuntimeCode(
    [`import { ${schemaName} } from "${file}";`, `export function ${validator(zod.name)}(value: unknown) {`, `  return ${schemaName}.safeParse(value).success;`, `}`].join('\n'),
  );
  controller.addCommonExport(typeName);
  controller.addCommonRuntimeExport(validator(zod.name));
};
