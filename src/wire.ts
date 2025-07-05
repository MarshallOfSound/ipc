import { Controller } from './controller';
import { Schema, StructureProperty } from './schema-type';
import { wireEnum } from './wiring/enum';
import { wireInterface } from './wiring/interface';
import { wireStructure } from './wiring/structure';
import { wireSubType } from './wiring/subtype';
import { wireValidator } from './wiring/validator';
import { basePrimitives } from './wiring/_constants';
import { wireZod } from './wiring/zod';

type SplitWiring = {
  internal: string;
  external: string;
};

type Wiring = {
  browser: SplitWiring;
  preload: SplitWiring;
  renderer: SplitWiring;
  common: SplitWiring;
  commonRuntime: SplitWiring;
};

export function buildWiring(schema: Schema): Wiring {
  let browser = `import { app as $$app$$ } from 'electron';\nexport * from '../common/${schema.name}';\n`;
  let preload = `import { contextBridge, ipcRenderer } from 'electron';\nexport * from '../common/${schema.name}';\n`;
  let common = '';
  let commonRuntime = '';

  const buildExternal = (type: string, exports: string[]) => {
    return [
      ...(type !== 'common' ? [`export * from '../common/${schema.name}';`] : []),
      ...(exports.length > 0 ? [`export { ${exports.join(', ')} } from '../_internal/${type}/${schema.name}';`] : []),
    ].join('\n');
  };

  const exportDupeCheck = (exportName: string, ...exportArrs: string[][]) => {
    for (const exportArr of exportArrs) {
      for (const exportkey of exportArr) {
        if (exportkey === exportName) {
          throw new Error(`Duplicate generated export ${exportName}, ensure you don't have duplicate interface / enum names`);
        }
      }
    }
  };

  const publicBrowserExports: string[] = [];
  const publicCommonExports: string[] = [];
  const publicPreloadExports: string[] = [];
  const commonExports: string[] = [];
  const commonRuntimeExports: string[] = [];
  const rendererBridgeInitializers: string[] = [];
  const rendererBridges: [string, string, string][] = [];

  const controller: Controller = {
    addPublicBrowserExport: (name: string) => {
      exportDupeCheck(name, publicCommonExports, publicBrowserExports);
      publicBrowserExports.push(name);
    },
    addPublicCommonExport: (name: string) => {
      exportDupeCheck(name, publicCommonExports, publicBrowserExports, publicPreloadExports);
      publicCommonExports.push(name);
    },
    addPublicPreloadExport: (name: string) => {
      exportDupeCheck(name, publicCommonExports, publicPreloadExports);
      publicPreloadExports.push(name);
    },
    addPreloadBridgeKeyAndType(module, key, type) {
      rendererBridges.push([module, key, type]);
    },
    addCommonExport: (name: string) => {
      exportDupeCheck(name, commonExports);
      commonExports.push(name);
    },
    addCommonCode: (code: string) => {
      common += code + '\n';
    },
    addCommonRuntimeCode: (code: string) => {
      commonRuntime += code + '\n';
    },
    addCommonRuntimeExport: (name: string) => {
      exportDupeCheck(name, commonRuntimeExports);
      commonRuntimeExports.push(name);
    },
    addBrowserCode: (code: string) => {
      browser += code + '\n';
    },
    addPreloadCode: (code: string) => {
      preload += code + '\n';
    },
    addPreloadBridgeInitializer: (name: string) => {
      rendererBridgeInitializers.push(name);
    },
  };

  const userProvidedTypeNames = schema.body
    .map((bodyElem) => (bodyElem.type === 'Validator' ? null : bodyElem.name))
    .filter(function (value: string | null): value is string {
      return value !== null;
    });

  for (const typeName of userProvidedTypeNames) {
    if (userProvidedTypeNames.filter((t) => t === typeName).length > 1) {
      throw new Error(`Duplicate declaration of identifier ${typeName}`);
    }
    if (basePrimitives.includes(typeName.toLowerCase())) {
      throw new Error(`Redeclare of built in primitive type "${typeName}"`);
    }
  }

  const allowedTypes = new Set([...userProvidedTypeNames, ...basePrimitives]);

  // Validate only using known types
  for (const bodyElem of schema.body) {
    switch (bodyElem.type) {
      case 'Enum': {
        break;
      }
      case 'Validator': {
        break;
      }
      case 'SubType': {
        if (!allowedTypes.has(bodyElem.parent)) {
          throw new Error(`SubType "${bodyElem.name}" has an unrecognized declared parent type of "${bodyElem.parent}"`);
        }
        break;
      }
      case 'Structure': {
        const validateProperties = (props: StructureProperty[], context = '') => {
          for (const prop of props) {
            if (prop.value.type === 'Identifier' || prop.value.type === 'Array' || prop.value.type === 'IdentifierIDX') {
              if (!allowedTypes.has(prop.value.name)) {
                throw new Error(`Structure "${bodyElem.name}" has an unrecognized type for property "${context}${prop.key}" of "${prop.value}"`);
              }
            } else if (prop.value.type === 'InlineStructure') {
              validateProperties(prop.value.properties, `${prop.key} -> `);
            } else {
              // validateKVM
            }
          }
        };
        validateProperties(bodyElem.properties);
        break;
      }
      case 'Interface': {
        for (const method of bodyElem.methods) {
          if (method.returns !== null) {
            const returnTypeBase = method.returns.type.name;
            if (!allowedTypes.has(returnTypeBase)) {
              throw new Error(`Interface "${bodyElem.name}" has an unrecognized return type for method "${method.name}" of "${method.returns}"`);
            }
          }
          if (new Set(method.arguments.map((arg) => arg.name)).size !== method.arguments.length) {
            throw new Error(`Interface "${bodyElem.name}" has duplicate argument names for method "${method.name}"`);
          }
          for (const arg of method.arguments) {
            const argTypeBase = arg.argType.name;
            if (!allowedTypes.has(argTypeBase)) {
              throw new Error(`Interface "${bodyElem.name}" has an unrecognized argument type for method "${method.name}" at argument "${arg.name}" of "${arg.argType.name}"`);
            }
          }
        }
        break;
      }
    }
  }

  for (const bodyElem of schema.body) {
    switch (bodyElem.type) {
      case 'Enum': {
        wireEnum(bodyElem, controller);
        break;
      }
      case 'SubType': {
        wireSubType(bodyElem, controller, schema);
        break;
      }
      case 'Validator': {
        wireValidator(bodyElem, controller);
        break;
      }
      case 'Structure': {
        wireStructure(bodyElem, controller);
        break;
      }
      case 'Interface': {
        wireInterface(bodyElem, controller, schema);
        break;
      }
      case 'ZodReference': {
        wireZod(bodyElem, controller);
        break;
      }
    }
  }

  const commonImportString = `import { ${commonExports.join(', ')} } from '../common/${schema.name}';\n`;
  const commonRuntimeImportString = `import { ${commonRuntimeExports.join(', ')} } from '../common-runtime/${schema.name}';\n`;

  if (rendererBridgeInitializers.length) {
    preload = `const bridged: Record<string, any> = {};\n` + preload;
  }

  browser = commonRuntimeImportString + commonImportString + browser;
  preload = commonImportString + preload;

  if (rendererBridgeInitializers.length) {
    preload += `${rendererBridgeInitializers.map((init) => `${init}(bridged);`).join('\n')}\n`;
    preload += `Object.keys(bridged).forEach(key => contextBridge.exposeInMainWorld(key, bridged[key]));\n`;
  }

  const renderer = rendererBridges
    .map(([moduleName, key, type]) => {
      return `import { ${type} } from '../common/${moduleName}';\nexport const ${key} = (window as any)['${moduleName}']['${key}'] as ${type}`;
    })
    .join('\n');

  return {
    browser: {
      internal: browser,
      external: buildExternal('browser', publicBrowserExports),
    },
    preload: {
      internal: preload,
      external: buildExternal('preload', publicPreloadExports),
    },
    renderer: {
      internal: '',
      external: renderer,
    },
    common: {
      internal: common,
      external: buildExternal('common', publicCommonExports),
    },
    commonRuntime: {
      internal: commonImportString + (commonRuntime || 'export { }'),
      external: '',
    },
  };
}
