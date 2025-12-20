import { parseEipc } from '../src/language/parser.js';
import { buildWiring } from '../src/wire.js';
import type { Module } from '../src/language/generated/ast.js';

export async function generateWiringFromString(schemaContent: string) {
  // Wrap content in a module declaration if not already present
  const wrappedContent = schemaContent.trim().startsWith('module ') ? schemaContent : `module test\n\n${schemaContent}`;

  const result = await parseEipc(wrappedContent, 'test.eipc');
  if (result.errors.length > 0) {
    throw new Error(`Parse errors: ${result.errors.map((e) => e.message).join(', ')}`);
  }
  const module: Module = result.ast;
  return buildWiring(module);
}
