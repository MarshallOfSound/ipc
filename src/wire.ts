import { Controller } from './controller.js';
import type {
  Module,
  ModuleElement,
  Enum,
  Interface,
  Structure,
  StructureBlock,
  StructureProperty,
  SubType,
  Validator,
  ZodReference,
  PropertyType,
  isEnum,
  isInterface,
  isStructure,
  isSubType,
  isValidator,
  isZodReference,
} from './language/generated/ast.js';
import { wireEnum } from './wiring/enum.js';
import { wireInterface } from './wiring/interface.js';
import { wireStructure } from './wiring/structure.js';
import { wireSubtype } from './wiring/subtype.js';
import { wireValidator } from './wiring/validator.js';
import { IPC_MESSAGE_PREFIX } from './wiring/_constants.js';
import { wireZodReference } from './wiring/zod.js';

// Re-export the AST types for use by consumers
export type { Module, Enum, Interface, Structure, SubType, Validator, ZodReference } from './language/generated/ast.js';

interface WiringOutput {
  browser: {
    internal: string;
    external: string;
  };
  preload: {
    internal: string;
    external: string;
  };
  renderer: {
    internal: string;
    external: string;
  };
  rendererHooks: {
    internal: string;
    external: string;
  };
  common: {
    internal: string;
    external: string;
  };
  commonRuntime: {
    internal: string;
    external: string;
  };
}

let common = `export interface IPCStore<T> {
  getState(): Promise<T>;
  getStateSync(): T;
  onStateChange(fn: (newState: T) => void): () => void;
}
`;

const PRIMITIVES = new Set(['string', 'number', 'boolean', 'null', 'void', 'unknown']);

/**
 * Validate schema semantics before code generation.
 * Catches errors that would otherwise only appear at runtime.
 */
function validateModule(module: Module, allowedTypes: Set<string>): void {
  const validators = new Set<string>();
  const errors: string[] = [];

  // Collect all validator names
  for (const elem of module.elements) {
    if (elem.$type === 'Validator') {
      validators.add(elem.name);
    }
  }

  // Validate each element
  for (const elem of module.elements) {
    switch (elem.$type) {
      case 'Interface':
        validateInterface(elem as Interface, validators, allowedTypes, errors);
        break;
      case 'Structure':
        validateStructure(elem as Structure, allowedTypes, errors);
        break;
      case 'Enum':
        validateEnum(elem as Enum, errors);
        break;
      case 'SubType':
        validateSubType(elem as SubType, allowedTypes, errors);
        break;
    }
  }

  if (errors.length > 0) {
    throw new Error(`Schema validation failed:\n\n${errors.join('\n\n')}`);
  }
}

function validateInterface(int: Interface, validators: Set<string>, allowedTypes: Set<string>, errors: string[]): void {
  // Check validator references exist
  for (const tag of int.tags) {
    if (tag.key === 'Validator' && tag.value) {
      if (!validators.has(tag.value)) {
        errors.push(`Interface "${int.name}" references validator "${tag.value}" which is not defined.\n` + `Available validators: ${[...validators].join(', ') || '(none)'}`);
      }
    }
  }

  // Check for duplicate method names
  const methodNames = new Set<string>();
  for (const method of int.methods) {
    if (methodNames.has(method.name)) {
      errors.push(`Interface "${int.name}" has duplicate method "${method.name}".`);
    }
    methodNames.add(method.name);

    // Validate method argument types exist
    for (const arg of method.arguments) {
      validateTypeReference(arg.type.reference, allowedTypes, `argument "${arg.name}" in method "${int.name}.${method.name}"`, errors);
    }

    // Validate return type exists
    if (method.returnType) {
      validateTypeReference(method.returnType.type.reference, allowedTypes, `return type of "${int.name}.${method.name}"`, errors);
    }
  }
}

function validateStructure(struct: Structure, allowedTypes: Set<string>, errors: string[]): void {
  validateStructureBlock(struct.block, struct.name, allowedTypes, errors);
}

function validateStructureBlock(block: StructureBlock, context: string, allowedTypes: Set<string>, errors: string[]): void {
  const propNames = new Set<string>();

  for (const prop of block.properties) {
    // Check for duplicate property names
    if (propNames.has(prop.name)) {
      errors.push(`Structure "${context}" has duplicate property "${prop.name}".`);
    }
    propNames.add(prop.name);

    // Validate property type
    validatePropertyType(prop.type, `property "${prop.name}" in structure "${context}"`, allowedTypes, errors);
  }
}

function validatePropertyType(propType: PropertyType, context: string, allowedTypes: Set<string>, errors: string[]): void {
  if (propType.$type === 'TypeReference') {
    validateTypeReference(propType.reference, allowedTypes, context, errors);
  } else if (propType.$type === 'StructureBlock') {
    validateStructureBlock(propType, context, allowedTypes, errors);
  } else if (propType.$type === 'KeyValueBlock') {
    validatePropertyType(propType.type, context, allowedTypes, errors);
  }
}

function validateEnum(en: Enum, errors: string[]): void {
  const optionNames = new Set<string>();
  const optionValues = new Set<string>();

  for (const opt of en.options) {
    // Check for duplicate option names
    if (optionNames.has(opt.name)) {
      errors.push(`Enum "${en.name}" has duplicate option name "${opt.name}".`);
    }
    optionNames.add(opt.name);

    // Check for duplicate option values
    const value = opt.value ?? opt.name;
    if (optionValues.has(value)) {
      errors.push(`Enum "${en.name}" has duplicate value "${value}".`);
    }
    optionValues.add(value);
  }
}

function validateSubType(subType: SubType, allowedTypes: Set<string>, errors: string[]): void {
  // Validate parent type exists (must be a primitive or another subtype)
  if (!PRIMITIVES.has(subType.parent) && !allowedTypes.has(subType.parent)) {
    errors.push(`SubType "${subType.name}" extends "${subType.parent}" which is not defined.\n` + `Base types must be primitives (string, number, boolean) or other subtypes.`);
  }
}

function validateTypeReference(typeName: string, allowedTypes: Set<string>, context: string, errors: string[]): void {
  if (!PRIMITIVES.has(typeName) && !allowedTypes.has(typeName)) {
    errors.push(`Type "${typeName}" used in ${context} is not defined.`);
  }
}

export function buildWiring(module: Module): WiringOutput {
  const controller = new Controller();

  // First pass - collect types for validation
  const allowedTypes = new Set(PRIMITIVES);

  // Collect all type names and build subtype map
  const subTypeMap = new Map<string, SubType>();
  const elementNames = new Map<string, string>(); // name -> element type

  for (const elem of module.elements) {
    const typeName = elem.name;

    // Check for duplicate element names
    if (allowedTypes.has(typeName) && PRIMITIVES.has(typeName)) {
      throw new Error(`Cannot redeclare built-in primitive type "${typeName}".`);
    }

    if (elementNames.has(typeName)) {
      throw new Error(`Duplicate definition of "${typeName}".\n\n` + `First defined as: ${elementNames.get(typeName)}\n` + `Also defined as: ${elem.$type}`);
    }

    elementNames.set(typeName, elem.$type);
    allowedTypes.add(typeName);

    if (elem.$type === 'SubType') {
      subTypeMap.set(typeName, elem as SubType);
    }
  }

  // Semantic validation
  validateModule(module, allowedTypes);

  // Validate and wire elements
  for (const elem of module.elements) {
    switch (elem.$type) {
      case 'SubType':
        wireSubtype(elem as SubType, allowedTypes, controller, subTypeMap);
        break;
      case 'Enum':
        wireEnum(elem as Enum, controller);
        break;
      case 'Structure':
        wireStructure(elem as Structure, allowedTypes, controller);
        break;
      case 'Validator':
        wireValidator(elem as Validator, controller);
        break;
      case 'ZodReference':
        wireZodReference(elem as ZodReference, controller);
        break;
      case 'Interface':
        wireInterface(elem as Interface, module, allowedTypes, controller);
        break;
    }
  }

  // Build output files
  const browserExports = controller.getBrowserExports();
  const preloadExports = controller.getPreloadExports();
  const rendererExports = controller.getRendererExports();
  const rendererHooksExports = controller.getRendererHooksExports();
  const commonExports = controller.getCommonExports();
  const commonRuntimeExports = controller.getCommonRuntimeExports();

  const externalFile = (type: string, exports: string[]) => {
    return [
      ...(type !== 'common' ? [`export * from '../common/${module.name}.js';`] : []),
      ...(exports.length > 0 ? [`export { ${exports.join(', ')} } from '../_internal/${type}/${module.name}.js';`] : []),
    ].join('\n');
  };

  // Browser internal
  let browser = `import { app as $$app$$ } from 'electron';\nexport * from '../common/${module.name}.js';\n`;
  if (commonExports.length > 0) {
    browser += `import { ${commonExports.join(', ')} } from '../common/${module.name}.js';\n`;
  }
  if (commonRuntimeExports.length > 0) {
    browser += `import { ${commonRuntimeExports.join(', ')} } from '../common-runtime/${module.name}.js';\n`;
  }
  browser += controller.getBrowserCode().join('\n');

  // Preload internal
  let preload = `import { contextBridge, ipcRenderer } from 'electron';\nexport * from '../common/${module.name}.js';\n`;
  if (commonExports.length > 0) {
    preload += `import { ${commonExports.join(', ')} } from '../common/${module.name}.js';\n`;
  }
  if (commonRuntimeExports.length > 0) {
    preload += `import { ${commonRuntimeExports.join(', ')} } from '../common-runtime/${module.name}.js';\n`;
  }
  const preloadCode = controller.getPreloadCode().join('\n');
  preload += preloadCode;

  // Add context bridge initialization
  const bridgeInitializers = controller.getPreloadBridgeInitializers();
  if (bridgeInitializers.length > 0) {
    preload += `\n\n// Initialize context bridge\nconst $$bridged$$ = {} as Record<string, any>;\n`;
    preload += bridgeInitializers.map((init) => `${init}($$bridged$$);`).join('\n');
    preload += `\nfor (const [key, value] of Object.entries($$bridged$$)) {\n  contextBridge.exposeInMainWorld(key, value);\n}\n`;
  }

  // Renderer internal
  let renderer = `export * from '../common/${module.name}.js';\n`;
  renderer += controller.getRendererCode().join('\n');

  // Renderer hooks internal - contains the actual React hook implementations
  let rendererHooks = controller.getRendererHooksCode().join('\n');
  if (rendererHooksExports.length > 0) {
    // Add React imports for hooks
    rendererHooks = `import { useState, useEffect } from 'react';\n` + rendererHooks;
  }

  // Common internal
  let commonCode = common;
  commonCode += controller.getCommonCode().join('\n');

  // Common runtime internal
  let commonRuntime = controller.getCommonRuntimeCode().join('\n');

  return {
    browser: {
      internal: browser,
      external: externalFile('browser', browserExports),
    },
    preload: {
      internal: preload,
      external: externalFile('preload', preloadExports),
    },
    renderer: {
      internal: renderer,
      external: externalFile('renderer', rendererExports),
    },
    rendererHooks: {
      internal: rendererHooks,
      external: rendererHooksExports.length > 0 ? `export { ${rendererHooksExports.join(', ')} } from '../_internal/renderer-hooks/${module.name}.js';` : '',
    },
    common: {
      internal: commonCode,
      external: externalFile('common', commonExports),
    },
    commonRuntime: {
      internal: commonRuntime,
      external: externalFile('common-runtime', commonRuntimeExports),
    },
  };
}
