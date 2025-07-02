import { Controller } from './controller';
import { Schema, StructureProperty } from './schema-type';
import { wireEnum } from './wiring/enum';
import { wireInterface } from './wiring/interface';
import { wireStructure } from './wiring/structure';
import { wireSubType } from './wiring/subtype';
import { wireValidator } from './wiring/validator';
import { basePrimitives } from './wiring/_constants';

type SplitWiring = {
  internal: string;
  external: string;
};

type Wiring = {
  browser: SplitWiring;
  renderer: SplitWiring;
  common: SplitWiring;
};

export function buildWiring(schema: Schema): Wiring {
  let browser = `import { ipcMain } from 'electron';\nexport * from '../common/${schema.name}';\n`;
  let renderer = `import { contextBridge, ipcRenderer } from 'electron';\nexport * from '../common/${schema.name}';\n`;
  let common = '';

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
  const publicRendererExports: string[] = [];
  const commonExports: string[] = [];
  const rendererBridgeInitializers: string[] = [];

  const controller: Controller = {
    addPublicBrowserExport: (name: string) => {
      exportDupeCheck(name, publicCommonExports, publicBrowserExports);
      publicBrowserExports.push(name);
    },
    addPublicCommonExport: (name: string) => {
      exportDupeCheck(name, publicCommonExports, publicBrowserExports, publicRendererExports);
      publicCommonExports.push(name);
    },
    addPublicRendererExport: (name: string) => {
      exportDupeCheck(name, publicCommonExports, publicRendererExports);
      publicRendererExports.push(name);
    },
    addCommonExport: (name: string) => {
      exportDupeCheck(name, commonExports);
      commonExports.push(name);
    },
    addCommonCode: (code: string) => {
      common += code + '\n';
    },
    addBrowserCode: (code: string) => {
      browser += code + '\n';
    },
    addRendererCode: (code: string) => {
      renderer += code + '\n';
    },
    addRendererBridgeInitializer: (name: string) => {
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
            if (typeof prop.value === 'string') {
              if (!allowedTypes.has(prop.value)) {
                throw new Error(`Structure "${bodyElem.name}" has an unrecognized type for property "${context}${prop.key}" of "${prop.value}"`);
              }
            } else {
              validateProperties(prop.value.properties, `${prop.key} -> `);
            }
          }
        };
        validateProperties(bodyElem.properties);
        break;
      }
      case 'Interface': {
        for (const method of bodyElem.methods) {
          if (method.returns !== null) {
            if (!allowedTypes.has(method.returns)) {
              throw new Error(`Interface "${bodyElem.name}" has an unrecognized return type for method "${method.name}" of "${method.returns}"`);
            }
            if (new Set(method.arguments.map((arg) => arg.name)).size !== method.arguments.length) {
              throw new Error(`Interface "${bodyElem.name}" has duplicate argument names for method "${method.name}"`);
            }
            for (const arg of method.arguments) {
              if (!allowedTypes.has(arg.argType)) {
                throw new Error(`Interface "${bodyElem.name}" has an unrecognized argument type for method "${method.name}" at argument "${arg.name}" of "${arg.argType}"`);
              }
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
    }
  }

  const commonImportString = `import { ${commonExports.join(', ')} } from '../common/${schema.name}';\n`;

  if (rendererBridgeInitializers.length) {
    renderer = `const bridged: Record<string, any> = {};\n` + renderer;
  }

  browser = commonImportString + browser;
  renderer = commonImportString + renderer;

  if (rendererBridgeInitializers.length) {
    renderer += `${rendererBridgeInitializers.map((init) => `${init}(bridged);`)}\n`;
    renderer += `Object.keys(bridged).forEach(key => contextBridge.exposeInMainWorld(key, bridged[key]));\n`;
  }

  return {
    browser: {
      internal: browser,
      external: buildExternal('browser', publicBrowserExports),
    },
    renderer: {
      internal: renderer,
      external: buildExternal('renderer', publicRendererExports),
    },
    common: {
      internal: common,
      external: buildExternal('common', publicCommonExports),
    },
  };
}
