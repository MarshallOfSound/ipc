import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  Definition,
  Location,
  Hover,
  MarkupContent,
  MarkupKind,
  Diagnostic,
  DiagnosticSeverity,
  Range,
  Position,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import * as fs from 'fs';
import * as path from 'path';

// Create connection
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Store parsed documents
interface ParsedModule {
  name: string;
  elements: Map<string, ElementInfo>;
  zodReferences: Map<string, ZodReferenceInfo>;
}

interface ElementInfo {
  name: string;
  type: 'validator' | 'enum' | 'structure' | 'subtype' | 'interface' | 'zod_reference';
  range: Range;
  detail?: string;
}

interface ZodReferenceInfo {
  name: string;
  importPath: string;
  typeName: string;
  schemaName: string;
  range: Range;
}

const parsedDocuments = new Map<string, ParsedModule>();

// Keywords for completion
const keywords = [
  'module',
  'validator',
  'enum',
  'structure',
  'subtype',
  'zod_reference',
  'interface',
  'AND',
  'OR',
  'is',
  'startsWith',
  'endsWith',
  'dynamic_global',
  'true',
  'false',
  'is_main_frame',
  'is_packaged',
  'is_about_blank',
  'origin',
  'protocol',
  'hostname',
  'href',
];

const typeKeywords = ['string', 'number', 'boolean', 'unknown'];

const interfaceTags = ['RendererAPI', 'Validator', 'ContextBridge', 'Sync', 'Event', 'Store', 'NotImplemented'];

// Documentation for validator conditions
const conditionDocs: Record<string, { description: string; example: string; values?: string }> = {
  is_main_frame: {
    description: 'Checks if the request comes from the main frame (not an iframe).',
    example: 'is_main_frame is true',
    values: '`true` or `false`',
  },
  is_packaged: {
    description: 'Checks if the Electron app is packaged (production) or running from source (development).',
    example: 'is_packaged is true',
    values: '`true` or `false`',
  },
  is_about_blank: {
    description: 'Checks if the page URL is `about:blank`. Useful for validating iframe content.',
    example: 'is_about_blank is false',
    values: '`true` or `false`',
  },
  origin: {
    description: 'Checks the page origin (protocol + host). Supports custom protocols like `app://`.',
    example: 'origin is "https://myapp.com"',
    values: 'A string like `"https://example.com"` or `"app://myapp"`',
  },
  protocol: {
    description: 'Checks the URL protocol (e.g., `https:`, `file:`, `app:`).',
    example: 'protocol is "https:"',
    values: 'A string like `"https:"`, `"http:"`, `"file:"`, `"app:"`',
  },
  hostname: {
    description: 'Checks the hostname portion of the URL.',
    example: 'hostname is "localhost"',
    values: 'A string like `"localhost"`, `"example.com"`',
  },
  href: {
    description: 'Checks the full URL (href) of the page.',
    example: 'href is "https://myapp.com/dashboard"',
    values: 'A full URL string',
  },
  dynamic_global: {
    description: 'Checks if a global variable is truthy in the main process. Useful for feature flags.',
    example: 'dynamic_global(FEATURE_ENABLED)',
    values: 'A variable name that exists on `globalThis` in main process',
  },
};

// Documentation for interface/method tags
const tagDocs: Record<string, { description: string; usage: string }> = {
  RendererAPI: {
    description: 'Marks an interface as a Renderer API - called from renderer, implemented in main process.',
    usage: '[RendererAPI]',
  },
  Validator: {
    description: 'Applies a validator to all methods in the interface. The validator runs on every IPC call.',
    usage: '[Validator=MyValidator]',
  },
  ContextBridge: {
    description: 'Automatically exposes the API via contextBridge to the renderer process.',
    usage: '[ContextBridge]',
  },
  Sync: {
    description: 'Makes the method synchronous (blocks the renderer). Use sparingly as it can cause UI freezes.',
    usage: '[Sync]',
  },
  Event: {
    description: 'Marks a method as an event dispatched from main to renderer. Cannot have a return type.',
    usage: '[Event]',
  },
  Store: {
    description: 'Creates reactive state with `getState()`, `getStateSync()`, and `onStateChange()`. Generates React hooks.',
    usage: '[Store]',
  },
  NotImplemented: {
    description: 'Placeholder for future features. Throws an error if called, but generates type definitions.',
    usage: '[NotImplemented]',
  },
};

// Documentation for logic operators
const operatorDocs: Record<string, { description: string; example: string }> = {
  AND: {
    description: 'Requires ALL conditions to be true.',
    example: 'AND(\\n    is_packaged is true\\n    origin is "https://myapp.com"\\n)',
  },
  OR: {
    description: 'Requires ANY condition to be true.',
    example: 'OR(\\n    hostname is "localhost"\\n    is_packaged is true\\n)',
  },
  is: {
    description: 'Compares a condition variable to a value.',
    example: 'is_main_frame is true',
  },
  startsWith: {
    description: 'Checks if a string condition starts with a prefix.',
    example: 'origin startsWith "https://"',
  },
  endsWith: {
    description: 'Checks if a string condition ends with a suffix.',
    example: 'hostname endsWith ".example.com"',
  },
};

// Documentation for subtype restrictions
const subtypeRestrictions: Record<
  string,
  {
    description: string;
    example: string;
    appliesTo: ('string' | 'number')[];
    valueType: 'number' | 'string' | 'boolean';
  }
> = {
  minLength: {
    description: 'Minimum string length (inclusive).',
    example: 'minLength: 3',
    appliesTo: ['string'],
    valueType: 'number',
  },
  maxLength: {
    description: 'Maximum string length (inclusive).',
    example: 'maxLength: 100',
    appliesTo: ['string'],
    valueType: 'number',
  },
  startsWith: {
    description: 'String must start with this prefix.',
    example: 'startsWith: "https://"',
    appliesTo: ['string'],
    valueType: 'string',
  },
  endsWith: {
    description: 'String must end with this suffix.',
    example: 'endsWith: ".com"',
    appliesTo: ['string'],
    valueType: 'string',
  },
  minValue: {
    description: 'Minimum numeric value (inclusive).',
    example: 'minValue: 0',
    appliesTo: ['number'],
    valueType: 'number',
  },
  maxValue: {
    description: 'Maximum numeric value (inclusive).',
    example: 'maxValue: 100',
    appliesTo: ['number'],
    valueType: 'number',
  },
};

connection.onInitialize((params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['[', '=', ':', ' '],
      },
      hoverProvider: true,
      definitionProvider: true,
    },
  };
});

// Simple parser to extract elements from document
function parseDocument(textDocument: TextDocument): ParsedModule {
  const text = textDocument.getText();
  const lines = text.split('\n');
  const elements = new Map<string, ElementInfo>();
  const zodReferences = new Map<string, ZodReferenceInfo>();
  let moduleName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Module declaration
    const moduleMatch = line.match(/^\s*module\s+([a-zA-Z_][a-zA-Z0-9_.]*)/);
    if (moduleMatch) {
      moduleName = moduleMatch[1];
      continue;
    }

    // Validator
    const validatorMatch = line.match(/^\s*validator\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
    if (validatorMatch) {
      const name = validatorMatch[1];
      elements.set(name, {
        name,
        type: 'validator',
        range: Range.create(i, 0, i, line.length),
        detail: 'Validator',
      });
      continue;
    }

    // Enum
    const enumMatch = line.match(/^\s*enum\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
    if (enumMatch) {
      const name = enumMatch[1];
      elements.set(name, {
        name,
        type: 'enum',
        range: Range.create(i, 0, i, line.length),
        detail: 'Enum',
      });
      continue;
    }

    // Structure
    const structureMatch = line.match(/^\s*structure\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
    if (structureMatch) {
      const name = structureMatch[1];
      elements.set(name, {
        name,
        type: 'structure',
        range: Range.create(i, 0, i, line.length),
        detail: 'Structure',
      });
      continue;
    }

    // Subtype
    const subtypeMatch = line.match(/^\s*subtype\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
    if (subtypeMatch) {
      const name = subtypeMatch[1];
      elements.set(name, {
        name,
        type: 'subtype',
        range: Range.create(i, 0, i, line.length),
        detail: 'Subtype',
      });
      continue;
    }

    // Interface
    const interfaceMatch = line.match(/^\s*interface\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
    if (interfaceMatch) {
      const name = interfaceMatch[1];
      elements.set(name, {
        name,
        type: 'interface',
        range: Range.create(i, 0, i, line.length),
        detail: 'Interface',
      });
      continue;
    }

    // Zod reference - start
    const zodRefMatch = line.match(/^\s*zod_reference\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
    if (zodRefMatch) {
      const name = zodRefMatch[1];
      const startLine = i;
      let importPath = '';
      let typeName = '';
      let schemaName = '';

      // Parse the zod_reference block
      for (let j = i + 1; j < lines.length && j < i + 10; j++) {
        const importMatch = lines[j].match(/import\s*=\s*"([^"]*)"/);
        if (importMatch) importPath = importMatch[1];

        const typeMatch = lines[j].match(/type\s*=\s*"([^"]*)"/);
        if (typeMatch) typeName = typeMatch[1];

        const schemaMatch = lines[j].match(/schema\s*=\s*"([^"]*)"/);
        if (schemaMatch) schemaName = schemaMatch[1];

        if (lines[j].includes('}')) break;
      }

      elements.set(name, {
        name,
        type: 'zod_reference',
        range: Range.create(startLine, 0, startLine, line.length),
        detail: `Zod Reference: ${typeName}`,
      });

      zodReferences.set(name, {
        name,
        importPath,
        typeName,
        schemaName,
        range: Range.create(startLine, 0, startLine, line.length),
      });
      continue;
    }
  }

  return { name: moduleName, elements, zodReferences };
}

// Valid properties for zod_reference blocks
const validZodReferenceProps = ['import', 'type', 'schema'];

// Valid subtype restrictions by base type
const validSubtypeRestrictions: Record<string, string[]> = {
  string: ['minLength', 'maxLength', 'startsWith', 'endsWith'],
  number: ['minValue', 'maxValue'],
};

// Valid condition names for validators
const validConditions = ['is_main_frame', 'is_packaged', 'is_about_blank', 'origin', 'protocol', 'hostname', 'href', 'dynamic_global'];

// Valid interface/method tags
const validTags = ['RendererAPI', 'Validator', 'ContextBridge', 'Sync', 'Event', 'Store', 'NotImplemented'];

// Validate document and return diagnostics
function validateDocument(textDocument: TextDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const text = textDocument.getText();
  const lines = text.split('\n');

  // First pass: collect all defined types and check for duplicates
  const definedTypes = new Set<string>(typeKeywords); // Built-in types
  const definedValidators = new Set<string>();
  const elementDefinitions = new Map<string, { type: string; line: number }>(); // Track where elements are defined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Helper to check and register element
    const registerElement = (name: string, type: string, startCol: number) => {
      if (elementDefinitions.has(name)) {
        const existing = elementDefinitions.get(name)!;
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(i, startCol, i, startCol + name.length),
          message: `Duplicate definition of "${name}". First defined as ${existing.type} on line ${existing.line + 1}.`,
          source: 'eipc',
        });
      } else {
        elementDefinitions.set(name, { type, line: i });
      }
    };

    // Enum
    const enumMatch = line.match(/^\s*enum\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (enumMatch) {
      definedTypes.add(enumMatch[1]);
      registerElement(enumMatch[1], 'enum', line.indexOf(enumMatch[1]));
    }

    // Structure
    const structMatch = line.match(/^\s*structure\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (structMatch) {
      definedTypes.add(structMatch[1]);
      registerElement(structMatch[1], 'structure', line.indexOf(structMatch[1]));
    }

    // Subtype
    const subtypeMatch = line.match(/^\s*subtype\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (subtypeMatch) {
      definedTypes.add(subtypeMatch[1]);
      registerElement(subtypeMatch[1], 'subtype', line.indexOf(subtypeMatch[1]));
    }

    // Zod reference
    const zodMatch = line.match(/^\s*zod_reference\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (zodMatch) {
      definedTypes.add(zodMatch[1]);
      registerElement(zodMatch[1], 'zod_reference', line.indexOf(zodMatch[1]));
    }

    // Validator
    const validatorMatch = line.match(/^\s*validator\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (validatorMatch) {
      definedValidators.add(validatorMatch[1]);
      registerElement(validatorMatch[1], 'validator', line.indexOf(validatorMatch[1]));
    }

    // Interface
    const interfaceMatch = line.match(/^\s*interface\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (interfaceMatch) {
      registerElement(interfaceMatch[1], 'interface', line.indexOf(interfaceMatch[1]));
    }
  }

  // Check for module declaration
  const moduleMatch = text.match(/^\s*module\s+/m);
  if (!moduleMatch) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: Range.create(0, 0, 0, lines[0]?.length || 0),
      message: 'Schema must start with a module declaration: module <name>',
      source: 'eipc',
    });
  }

  // Second pass: validate references and properties
  let braceCount = 0;
  let parenCount = 0;
  let currentBlock: {
    type: string;
    name?: string;
    baseType?: string;
    startLine: number;
    members?: Map<string, number>; // Track member names -> line number for duplicate detection
    enumValues?: Map<string, number>; // Track enum values -> line number
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments
    if (line.trim().startsWith('//')) continue;

    // Track block context
    const zodRefStart = line.match(/^\s*zod_reference\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
    if (zodRefStart) {
      currentBlock = { type: 'zod_reference', name: zodRefStart[1], startLine: i };
    }

    const subtypeStart = line.match(/^\s*subtype\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(string|number)\s*\(/);
    if (subtypeStart) {
      currentBlock = { type: 'subtype', name: subtypeStart[1], baseType: subtypeStart[2], startLine: i };
    }

    const validatorStart = line.match(/^\s*validator\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
    if (validatorStart) {
      currentBlock = { type: 'validator', name: validatorStart[1], startLine: i };
    }

    const interfaceStart = line.match(/^\s*interface\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
    if (interfaceStart) {
      currentBlock = { type: 'interface', name: interfaceStart[1], startLine: i, members: new Map() };
    }

    const structureStart = line.match(/^\s*structure\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
    if (structureStart) {
      currentBlock = { type: 'structure', name: structureStart[1], startLine: i, members: new Map() };
    }

    const enumStart = line.match(/^\s*enum\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
    if (enumStart) {
      currentBlock = { type: 'enum', name: enumStart[1], startLine: i, members: new Map(), enumValues: new Map() };
    }

    // Check for duplicate method names in interfaces
    if (currentBlock?.type === 'interface' && currentBlock.members) {
      const methodMatch = line.match(/^\s*(?:\[[^\]]*\]\s*)*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
      if (methodMatch) {
        const methodName = methodMatch[1];
        const methodStart = line.indexOf(methodName);
        if (currentBlock.members.has(methodName)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(i, methodStart, i, methodStart + methodName.length),
            message: `Duplicate method "${methodName}" in interface "${currentBlock.name}". First defined on line ${currentBlock.members.get(methodName)! + 1}.`,
            source: 'eipc',
          });
        } else {
          currentBlock.members.set(methodName, i);
        }
      }
    }

    // Check for duplicate property names in structures
    if (currentBlock?.type === 'structure' && currentBlock.members) {
      const propMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??:\s*/);
      if (propMatch) {
        const propName = propMatch[1];
        const propStart = line.indexOf(propName);
        if (currentBlock.members.has(propName)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(i, propStart, i, propStart + propName.length),
            message: `Duplicate property "${propName}" in structure "${currentBlock.name}". First defined on line ${currentBlock.members.get(propName)! + 1}.`,
            source: 'eipc',
          });
        } else {
          currentBlock.members.set(propName, i);
        }
      }
    }

    // Check for duplicate enum option names and values
    if (currentBlock?.type === 'enum' && currentBlock.members && currentBlock.enumValues) {
      const enumOptMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=\s*"([^"]*)")?/);
      if (enumOptMatch && !line.match(/^\s*enum\s+/) && !line.trim().startsWith('}')) {
        const optionName = enumOptMatch[1];
        const optionValue = enumOptMatch[2] ?? optionName; // Default value is the name itself
        const optStart = line.indexOf(optionName);

        // Check duplicate name
        if (currentBlock.members.has(optionName)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(i, optStart, i, optStart + optionName.length),
            message: `Duplicate enum option name "${optionName}" in enum "${currentBlock.name}". First defined on line ${currentBlock.members.get(optionName)! + 1}.`,
            source: 'eipc',
          });
        } else {
          currentBlock.members.set(optionName, i);
        }

        // Check duplicate value
        if (currentBlock.enumValues.has(optionValue)) {
          const valueStart = enumOptMatch[2] ? line.indexOf(`"${optionValue}"`) : optStart;
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(i, valueStart, i, valueStart + optionValue.length + (enumOptMatch[2] ? 2 : 0)),
            message: `Duplicate enum value "${optionValue}" in enum "${currentBlock.name}". First used on line ${currentBlock.enumValues.get(optionValue)! + 1}.`,
            source: 'eipc',
          });
        } else {
          currentBlock.enumValues.set(optionValue, i);
        }
      }
    }

    // Check for closing braces/parens to exit blocks
    if (currentBlock && currentBlock.type !== 'validator') {
      if (currentBlock.type === 'subtype' && line.includes(')')) {
        currentBlock = null;
      } else if (currentBlock.type !== 'subtype' && line.includes('}')) {
        currentBlock = null;
      }
    }

    // Validate zod_reference properties
    if (currentBlock?.type === 'zod_reference') {
      const propMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
      if (propMatch && !validZodReferenceProps.includes(propMatch[1])) {
        const propStart = line.indexOf(propMatch[1]);
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(i, propStart, i, propStart + propMatch[1].length),
          message: `Invalid zod_reference property '${propMatch[1]}'. Valid properties: ${validZodReferenceProps.join(', ')}`,
          source: 'eipc',
        });
      }
    }

    // Validate subtype restrictions
    if (currentBlock?.type === 'subtype' && currentBlock.baseType) {
      const restrictionMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
      if (restrictionMatch) {
        const restrictionName = restrictionMatch[1];
        const validForType = validSubtypeRestrictions[currentBlock.baseType] || [];
        const allRestrictions = [...validSubtypeRestrictions.string, ...validSubtypeRestrictions.number];

        if (!validForType.includes(restrictionName)) {
          const propStart = line.indexOf(restrictionName);
          if (allRestrictions.includes(restrictionName)) {
            // Valid restriction but wrong type
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: Range.create(i, propStart, i, propStart + restrictionName.length),
              message: `Restriction '${restrictionName}' cannot be used with '${currentBlock.baseType}' subtypes`,
              source: 'eipc',
            });
          } else {
            // Unknown restriction
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: Range.create(i, propStart, i, propStart + restrictionName.length),
              message: `Unknown subtype restriction '${restrictionName}'. Valid for ${currentBlock.baseType}: ${validForType.join(', ')}`,
              source: 'eipc',
            });
          }
        }
      }
    }

    // Validate validator conditions
    if (currentBlock?.type === 'validator') {
      // Check for condition usage (word followed by 'is' or 'startsWith')
      const conditionMatches = line.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s+(is|startsWith|endsWith)\b/g);
      for (const match of conditionMatches) {
        const conditionName = match[1];
        // Skip AND, OR, true, false
        if (['AND', 'OR', 'true', 'false'].includes(conditionName)) continue;

        if (!validConditions.includes(conditionName)) {
          const condStart = line.indexOf(match[0]);
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(i, condStart, i, condStart + conditionName.length),
            message: `Unknown validator condition '${conditionName}'. Valid conditions: ${validConditions.join(', ')}`,
            source: 'eipc',
          });
        }
      }

      // Exit validator when parentheses balance
      for (const char of line) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
      }
      if (parenCount <= 0 && i > currentBlock.startLine) {
        currentBlock = null;
        parenCount = 0;
      }
    }

    // Validate interface/method tags
    const tagMatches = line.matchAll(/\[([a-zA-Z_][a-zA-Z0-9_]*)(?:=[^\]]+)?\]/g);
    for (const match of tagMatches) {
      const tagName = match[1];
      if (!validTags.includes(tagName)) {
        const tagStart = line.indexOf(match[0]) + 1; // +1 to skip the '['
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(i, tagStart, i, tagStart + tagName.length),
          message: `Unknown tag '${tagName}'. Valid tags: ${validTags.join(', ')}`,
          source: 'eipc',
        });
      }
    }

    // Validate [Validator=X] references
    const validatorRefMatch = line.match(/\[Validator\s*=\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\]/);
    if (validatorRefMatch) {
      const validatorName = validatorRefMatch[1];
      if (!definedValidators.has(validatorName)) {
        const valStart = line.indexOf(validatorName, line.indexOf('Validator='));
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(i, valStart, i, valStart + validatorName.length),
          message: `Undefined validator '${validatorName}'`,
          source: 'eipc',
        });
      }
    }

    // Validate type references (in structure fields, method params/returns, etc.)
    if (currentBlock?.type === 'structure' || currentBlock?.type === 'interface') {
      // Match field/param type: "name: TypeName" or "name: TypeName[]" or "name: TypeName?"
      // Use matchAll with index to get correct positions
      const typeRefRegex = /:\s*([a-zA-Z_][a-zA-Z0-9_]*)(\[\]|\?)?/g;
      let typeMatch;
      while ((typeMatch = typeRefRegex.exec(line)) !== null) {
        const typeName = typeMatch[1];
        const typeStart = typeMatch.index + typeMatch[0].indexOf(typeName);
        if (!definedTypes.has(typeName)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(i, typeStart, i, typeStart + typeName.length),
            message: `Undefined type '${typeName}'`,
            source: 'eipc',
          });
        } else if (typeName === 'unknown') {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: Range.create(i, typeStart, i, typeStart + typeName.length),
            message: `⚠️ DANGER: 'unknown' bypasses all type safety and validation. Consider using a structure or zod_reference instead.`,
            source: 'eipc',
          });
        }
      }

      // Match return type: "-> TypeName" or "-> TypeName[]"
      const returnTypeRegex = /->\s*([a-zA-Z_][a-zA-Z0-9_]*)(\[\])?/g;
      let returnMatch;
      while ((returnMatch = returnTypeRegex.exec(line)) !== null) {
        const typeName = returnMatch[1];
        const typeStart = returnMatch.index + returnMatch[0].indexOf(typeName);
        if (!definedTypes.has(typeName)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: Range.create(i, typeStart, i, typeStart + typeName.length),
            message: `Undefined type '${typeName}'`,
            source: 'eipc',
          });
        } else if (typeName === 'unknown') {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: Range.create(i, typeStart, i, typeStart + typeName.length),
            message: `⚠️ DANGER: 'unknown' bypasses all type safety and validation. Consider using a structure or zod_reference instead.`,
            source: 'eipc',
          });
        }
      }
    }

    // Track braces for unclosed brace detection
    for (const char of line) {
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
    }
  }

  if (braceCount > 0) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: Range.create(lines.length - 1, 0, lines.length - 1, lines[lines.length - 1]?.length || 0),
      message: `Unclosed brace: ${braceCount} opening brace(s) without matching closing brace`,
      source: 'eipc',
    });
  }

  return diagnostics;
}

// Document change handler
documents.onDidChangeContent((change) => {
  const parsed = parseDocument(change.document);
  parsedDocuments.set(change.document.uri, parsed);

  const diagnostics = validateDocument(change.document);
  connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

// Completion provider
connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: params.position,
  });

  const items: CompletionItem[] = [];

  // Check if we're inside a validator block
  const isInValidator = isInsideValidatorBlock(document, params.position.line);

  // After '[' suggest tags
  if (line.match(/\[\s*$/)) {
    interfaceTags.forEach((tag) => {
      const doc = tagDocs[tag];
      items.push({
        label: tag,
        kind: CompletionItemKind.Keyword,
        detail: 'Interface/Method tag',
        documentation: doc ? { kind: MarkupKind.Markdown, value: doc.description } : undefined,
      });
    });
    return items;
  }

  // After '[Validator=' suggest validators
  if (line.match(/\[Validator\s*=\s*$/)) {
    const parsed = parsedDocuments.get(params.textDocument.uri);
    if (parsed) {
      parsed.elements.forEach((elem) => {
        if (elem.type === 'validator') {
          items.push({
            label: elem.name,
            kind: CompletionItemKind.Function,
            detail: 'Validator',
          });
        }
      });
    }
    return items;
  }

  // After ':' or '->' suggest types
  if (line.match(/[:\-]>\s*$/) || line.match(/:\s*$/)) {
    // Built-in types
    typeKeywords.forEach((type) => {
      items.push({
        label: type,
        kind: CompletionItemKind.Keyword,
        detail: 'Built-in type',
      });
    });

    // User-defined types
    const parsed = parsedDocuments.get(params.textDocument.uri);
    if (parsed) {
      parsed.elements.forEach((elem) => {
        if (['enum', 'structure', 'subtype', 'zod_reference'].includes(elem.type)) {
          items.push({
            label: elem.name,
            kind: elem.type === 'enum' ? CompletionItemKind.Enum : CompletionItemKind.Struct,
            detail: elem.detail,
          });
        }
      });
    }
    return items;
  }

  // Check if we're inside a subtype block
  const subtypeContext = isInsideSubtypeBlock(document, params.position.line);

  // Inside subtype: suggest restrictions
  if (subtypeContext.inSubtype) {
    Object.entries(subtypeRestrictions).forEach(([name, doc]) => {
      // Only suggest restrictions that apply to this base type
      if (subtypeContext.baseType && doc.appliesTo.includes(subtypeContext.baseType)) {
        let insertText: string;
        if (doc.valueType === 'string') {
          insertText = `${name}: "$1"`;
        } else {
          insertText = `${name}: $1`;
        }

        items.push({
          label: name,
          kind: CompletionItemKind.Property,
          detail: `Restriction (${doc.appliesTo.join(', ')})`,
          documentation: {
            kind: MarkupKind.Markdown,
            value: `${doc.description}\n\n**Example:** \`${doc.example}\``,
          },
          insertText,
          insertTextFormat: 2, // Snippet
        });
      }
    });

    return items;
  }

  // Inside validator: suggest conditions and operators
  if (isInValidator) {
    // Suggest condition variables
    Object.entries(conditionDocs).forEach(([name, doc]) => {
      items.push({
        label: name,
        kind: CompletionItemKind.Variable,
        detail: 'Condition',
        documentation: {
          kind: MarkupKind.Markdown,
          value: `${doc.description}\n\n**Example:** \`${doc.example}\``,
        },
        insertText: name === 'dynamic_global' ? 'dynamic_global($1)' : `${name} is $1`,
        insertTextFormat: 2, // Snippet
      });
    });

    // Suggest logic operators
    items.push({
      label: 'AND',
      kind: CompletionItemKind.Keyword,
      detail: 'Logic operator',
      documentation: { kind: MarkupKind.Markdown, value: operatorDocs.AND.description },
      insertText: 'AND(\n    $0\n)',
      insertTextFormat: 2,
    });
    items.push({
      label: 'OR',
      kind: CompletionItemKind.Keyword,
      detail: 'Logic operator',
      documentation: { kind: MarkupKind.Markdown, value: operatorDocs.OR.description },
      insertText: 'OR(\n    $0\n)',
      insertTextFormat: 2,
    });

    return items;
  }

  // Default: suggest keywords
  keywords.forEach((kw) => {
    items.push({
      label: kw,
      kind: CompletionItemKind.Keyword,
    });
  });

  return items;
});

// Helper: check if we're inside a subtype block and return the base type
function isInsideSubtypeBlock(document: TextDocument, lineNum: number): { inSubtype: boolean; baseType: 'string' | 'number' | null } {
  const text = document.getText();
  const lines = text.split('\n');

  for (let i = lineNum; i >= 0; i--) {
    const line = lines[i];

    // Check if this line declares a subtype - uses parentheses not braces
    const subtypeMatch = line.match(/^\s*subtype\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*(string|number)\s*\(/);
    if (subtypeMatch) {
      // Check if we're still inside the block (look for closing paren)
      let parenCount = 0;
      for (let j = i; j <= lineNum; j++) {
        for (const char of lines[j]) {
          if (char === '(') parenCount++;
          if (char === ')') parenCount--;
        }
      }
      if (parenCount > 0) {
        return { inSubtype: true, baseType: subtypeMatch[1] as 'string' | 'number' };
      }
      return { inSubtype: false, baseType: null };
    }

    // If we hit another top-level declaration, we're not in a subtype
    if (line.match(/^\s*(module|validator|enum|structure|interface|zod_reference)\s+/)) {
      return { inSubtype: false, baseType: null };
    }
  }

  return { inSubtype: false, baseType: null };
}

// Helper: check if we're inside a validator block
function isInsideValidatorBlock(document: TextDocument, lineNum: number): boolean {
  const text = document.getText();
  const lines = text.split('\n');

  let parenDepth = 0;
  let inValidator = false;

  for (let i = 0; i <= lineNum; i++) {
    const line = lines[i];

    // Check if this line starts a validator
    if (line.match(/^\s*validator\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=/)) {
      inValidator = true;
      parenDepth = 0;
    }

    // Check if we hit another top-level declaration
    if (line.match(/^\s*(module|enum|structure|subtype|zod_reference|interface)\s+/)) {
      inValidator = false;
    }

    // Track parentheses
    for (const char of line) {
      if (char === '(') parenDepth++;
      if (char === ')') parenDepth--;
    }

    // If we're past the validator and parens are balanced, we're out
    if (inValidator && i > 0 && parenDepth <= 0 && !line.match(/^\s*validator/)) {
      // Check if previous lines closed the validator
      const prevLine = lines[i - 1] || '';
      if (prevLine.includes(')') && !line.match(/^\s*(AND|OR|\))/)) {
        inValidator = false;
      }
    }
  }

  return inValidator && parenDepth > 0;
}

// Hover provider
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const word = getWordAtPosition(document, params.position);
  if (!word) return null;

  const parsed = parsedDocuments.get(params.textDocument.uri);
  if (!parsed) return null;

  // Check for validator condition variables
  if (conditionDocs[word]) {
    const doc = conditionDocs[word];
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [`**Condition:** \`${word}\``, '', doc.description, '', '**Example:**', '```', doc.example, '```', ...(doc.values ? ['', `**Values:** ${doc.values}`] : [])].join(
          '\n',
        ),
      },
    };
  }

  // Check for logic operators (AND, OR, is, startsWith)
  if (operatorDocs[word]) {
    const doc = operatorDocs[word];
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [`**Operator:** \`${word}\``, '', doc.description, '', '**Example:**', '```', doc.example, '```'].join('\n'),
      },
    };
  }

  // Check for interface/method tags
  if (tagDocs[word]) {
    const doc = tagDocs[word];
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [`**Tag:** \`${word}\``, '', doc.description, '', '**Usage:** `' + doc.usage + '`'].join('\n'),
      },
    };
  }

  // Check for subtype restrictions
  if (subtypeRestrictions[word]) {
    const doc = subtypeRestrictions[word];
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: [
          `**Subtype Restriction:** \`${word}\``,
          '',
          doc.description,
          '',
          '**Example:**',
          '```',
          doc.example,
          '```',
          '',
          `**Applies to:** \`${doc.appliesTo.join('`, `')}\``,
        ].join('\n'),
      },
    };
  }

  // Check for user-defined elements
  const element = parsed.elements.get(word);
  if (element) {
    const content: MarkupContent = {
      kind: MarkupKind.Markdown,
      value: `**${element.type}** \`${element.name}\``,
    };

    if (element.type === 'zod_reference') {
      const zodRef = parsed.zodReferences.get(word);
      if (zodRef) {
        content.value = [
          `**zod_reference** \`${element.name}\``,
          '',
          `- **Import:** \`${zodRef.importPath}\``,
          `- **Type:** \`${zodRef.typeName}\``,
          `- **Schema:** \`${zodRef.schemaName}\``,
        ].join('\n');
      }
    }

    return { contents: content };
  }

  // Check for type keywords
  if (typeKeywords.includes(word)) {
    if (word === 'unknown') {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: [
            '## ⚠️ DANGER: `unknown` Type',
            '',
            '**🚨 WARNING: This type bypasses all type safety!**',
            '',
            'Using `unknown` means:',
            '- ❌ No compile-time type checking',
            '- ❌ No runtime validation',
            '- ❌ Any value can be passed through IPC',
            '- ❌ Potential security vulnerabilities',
            '',
            '**Consider using:**',
            '- A `structure` with explicit fields',
            '- A `zod_reference` for complex validation',
            '- A union of specific types',
            '',
            '_Only use `unknown` if you truly need to accept arbitrary data and will validate it manually._',
          ].join('\n'),
        },
      };
    }
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**Built-in Type:** \`${word}\``,
      },
    };
  }

  // Check for other keywords
  if (keywords.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**Keyword:** \`${word}\``,
      },
    };
  }

  return null;
});

// Go to definition provider
connection.onDefinition((params: TextDocumentPositionParams): Definition | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const parsed = parsedDocuments.get(params.textDocument.uri);
  if (!parsed) return null;

  const line = document.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: 1000 },
  });

  // Check if cursor is on a zod_reference type or schema string value
  const zodTypeMatch = line.match(/type\s*=\s*"([^"]*)"/);
  const zodSchemaMatch = line.match(/schema\s*=\s*"([^"]*)"/);
  const zodImportMatch = line.match(/import\s*=\s*"([^"]*)"/);

  if (zodTypeMatch || zodSchemaMatch || zodImportMatch) {
    // Find which zod_reference block we're in
    const zodRef = findZodReferenceAtLine(document, params.position.line, parsed);
    if (zodRef) {
      const targetFile = resolveZodImportPath(params.textDocument.uri, zodRef.importPath);
      if (targetFile) {
        if (zodTypeMatch) {
          // Go to type definition
          const location = findZodTypeDefinition(targetFile, zodRef.typeName);
          if (location) return location;
        } else if (zodSchemaMatch) {
          // Go to schema definition
          const location = findZodSchemaDefinition(targetFile, zodRef.schemaName);
          if (location) return location;
        }
        // Fallback: just open the file
        return Location.create(URI.file(targetFile).toString(), Range.create(0, 0, 0, 0));
      }
    }
  }

  const word = getWordAtPosition(document, params.position);
  if (!word) return null;

  // Check if it's a local element
  const element = parsed.elements.get(word);
  if (element) {
    // For zod_reference, try to go to the TypeScript file
    if (element.type === 'zod_reference') {
      const zodRef = parsed.zodReferences.get(word);
      if (zodRef) {
        const targetFile = resolveZodImportPath(params.textDocument.uri, zodRef.importPath);
        if (targetFile) {
          // Try to find the type/schema in the file
          const location = findZodDefinition(targetFile, zodRef.typeName, zodRef.schemaName);
          if (location) {
            return location;
          }
          // Fallback: just open the file at the top
          return Location.create(URI.file(targetFile).toString(), Range.create(0, 0, 0, 0));
        }
      }
    }

    return Location.create(params.textDocument.uri, element.range);
  }

  // Look for type references
  const typeRef = parsed.elements.get(word);
  if (typeRef) {
    return Location.create(params.textDocument.uri, typeRef.range);
  }

  return null;
});

// Helper: find which zod_reference block contains the given line
function findZodReferenceAtLine(document: TextDocument, lineNum: number, parsed: ParsedModule): ZodReferenceInfo | null {
  const text = document.getText();
  const lines = text.split('\n');

  // Search backwards from current line to find zod_reference declaration
  for (let i = lineNum; i >= 0; i--) {
    const line = lines[i];
    const match = line.match(/^\s*zod_reference\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/);
    if (match) {
      const name = match[1];
      return parsed.zodReferences.get(name) || null;
    }
    // If we hit another block type, we're not in a zod_reference
    if (line.match(/^\s*(module|validator|enum|structure|subtype|interface)\s+/)) {
      return null;
    }
  }
  return null;
}

// Helper: find type definition in TypeScript file
function findZodTypeDefinition(filePath: string, typeName: string): Location | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match: export type TypeName = ...
      if (line.match(new RegExp(`export\\s+type\\s+${typeName}\\s*=`))) {
        return Location.create(URI.file(filePath).toString(), Range.create(i, 0, i, line.length));
      }
      // Match: export interface TypeName {
      if (line.match(new RegExp(`export\\s+interface\\s+${typeName}\\s*\\{`))) {
        return Location.create(URI.file(filePath).toString(), Range.create(i, 0, i, line.length));
      }
    }
  } catch (e) {
    // File read error
  }
  return null;
}

// Helper: find schema definition in TypeScript file
function findZodSchemaDefinition(filePath: string, schemaName: string): Location | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match: export const schemaName = z...
      if (line.match(new RegExp(`export\\s+const\\s+${schemaName}\\s*=`))) {
        return Location.create(URI.file(filePath).toString(), Range.create(i, 0, i, line.length));
      }
      // Match: const schemaName = z... (non-exported)
      if (line.match(new RegExp(`const\\s+${schemaName}\\s*=`))) {
        return Location.create(URI.file(filePath).toString(), Range.create(i, 0, i, line.length));
      }
    }
  } catch (e) {
    // File read error
  }
  return null;
}

// Helper: get word at position
function getWordAtPosition(document: TextDocument, position: Position): string | null {
  const line = document.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line, character: 1000 },
  });

  // Find word boundaries
  let start = position.character;
  let end = position.character;

  while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) {
    start--;
  }
  while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) {
    end++;
  }

  if (start === end) return null;
  return line.substring(start, end);
}

// Helper: resolve zod import path to absolute file path
function resolveZodImportPath(documentUri: string, importPath: string): string | null {
  const documentPath = URI.parse(documentUri).fsPath;
  const documentDir = path.dirname(documentPath);

  // The import path is relative to the generated ipc/_internal/ directory
  // We need to find the actual source file
  // Go up from the .eipc file and look for the import

  // Try relative to document
  let resolved = path.resolve(documentDir, importPath);
  for (const ext of ['', '.ts', '.js', '.tsx', '.jsx']) {
    const candidate = resolved + ext;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Try relative to common-runtime location (where imports are resolved from)
  const ipcDir = path.resolve(documentDir, 'ipc', '_internal', 'common-runtime');
  resolved = path.resolve(ipcDir, importPath);
  for (const ext of ['', '.ts', '.js', '.tsx', '.jsx']) {
    const candidate = resolved + ext;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// Helper: find type or schema definition in TypeScript file
function findZodDefinition(filePath: string, typeName: string, schemaName: string): Location | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Look for type definition
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match: export type TypeName = ...
      if (line.match(new RegExp(`export\\s+type\\s+${typeName}\\s*=`))) {
        return Location.create(URI.file(filePath).toString(), Range.create(i, 0, i, line.length));
      }

      // Match: export const schemaName = z...
      if (line.match(new RegExp(`export\\s+const\\s+${schemaName}\\s*=`))) {
        return Location.create(URI.file(filePath).toString(), Range.create(i, 0, i, line.length));
      }

      // Match: export interface TypeName {
      if (line.match(new RegExp(`export\\s+interface\\s+${typeName}\\s*\\{`))) {
        return Location.create(URI.file(filePath).toString(), Range.create(i, 0, i, line.length));
      }
    }
  } catch (e) {
    // File read error
  }

  return null;
}

// Start listening
documents.listen(connection);
connection.listen();
