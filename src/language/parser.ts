import { EmptyFileSystem, URI } from 'langium';
import { createEipcServices } from './eipc-module.js';
import type { Module } from './generated/ast.js';

const services = createEipcServices({ ...EmptyFileSystem });
const documentBuilder = services.shared.workspace.DocumentBuilder;

export interface ParseResult {
  ast: Module;
  errors: ParseError[];
}

export interface ParseError {
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

/**
 * Parse an eipc schema file and return the AST with any errors
 */
export async function parseEipc(content: string, fileName: string = 'input.eipc'): Promise<ParseResult> {
  const uri = URI.parse(`memory:///${fileName}`);
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(content, uri);

  services.shared.workspace.LangiumDocuments.addDocument(document);

  await documentBuilder.build([document], { validation: true });

  const errors: ParseError[] = [];

  // Collect lexer errors
  for (const error of document.parseResult.lexerErrors) {
    errors.push({
      message: error.message,
      line: error.line ?? 1,
      column: error.column ?? 1,
    });
  }

  // Collect parser errors
  for (const error of document.parseResult.parserErrors) {
    const token = error.token;
    errors.push({
      message: error.message,
      line: token.startLine ?? 1,
      column: token.startColumn ?? 1,
      endLine: token.endLine,
      endColumn: token.endColumn,
    });
  }

  // Collect validation errors
  const diagnostics = document.diagnostics ?? [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.range) {
      errors.push({
        message: diagnostic.message,
        line: diagnostic.range.start.line + 1,
        column: diagnostic.range.start.character + 1,
        endLine: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
      });
    }
  }

  // Clean up
  services.shared.workspace.LangiumDocuments.deleteDocument(uri);

  return {
    ast: document.parseResult.value as Module,
    errors,
  };
}

/**
 * Format a parse error into a user-friendly string
 */
export function formatParseError(error: ParseError, fileName: string, content: string): string {
  const lines = content.split('\n');
  const errorLine = lines[error.line - 1] || '';
  const pointer = ' '.repeat(error.column - 1) + '^';

  return [
    ``,
    `Parse error in ${fileName} at line ${error.line}, column ${error.column}:`,
    ``,
    `  ${error.line} | ${errorLine}`,
    `    ${' '.repeat(String(error.line).length)} | ${pointer}`,
    ``,
    error.message,
    ``,
  ].join('\n');
}
