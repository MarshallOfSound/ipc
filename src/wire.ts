import { Controller } from './controller.js';
import type {
  Module,
  ModuleElement,
  Enum,
  Interface,
  Structure,
  SubType,
  Validator,
  ZodReference,
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

export function buildWiring(module: Module): WiringOutput {
  const controller = new Controller();

  // First pass - collect types for validation
  const allowedTypes = new Set(['string', 'number', 'boolean', 'null', 'void']);

  // Collect all type names and build subtype map
  const subTypeMap = new Map<string, SubType>();
  for (const elem of module.elements) {
    const typeName = elem.name;
    if (allowedTypes.has(typeName)) {
      throw new Error(`Redeclare of built in primitive type "${typeName}"`);
    }
    allowedTypes.add(typeName);
    if (elem.$type === 'SubType') {
      subTypeMap.set(typeName, elem as SubType);
    }
  }

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
