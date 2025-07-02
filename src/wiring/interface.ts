import { Controller } from '../controller';
import { Interface, InterfaceMethod, MethodArgument, Schema } from '../schema-type';
import { basePrimitives, eventValidator, INTERFACE_IMPL_PREFIX, ipcMessage, validator } from './_constants';

enum InterfaceType {
  RendererAPI,
  BroadcastAPI,
}

type MethodTagInfo = {
  synchronous: boolean;
};

const validatorFnOrPrimitiveValidator = (type: string, argName: string) => {
  if (basePrimitives.includes(type)) return `(typeof ${argName} === '${type}')`;
  return `${validator(type)}(${argName})`;
};

function methodTagInfo(method: InterfaceMethod) {
  const info: MethodTagInfo = {
    synchronous: false,
  };

  for (const tag of method.tags) {
    if (tag.key === 'Sync') {
      info.synchronous = true;
    } else {
      throw new Error(`Unrecognized tag "${tag.key}" on method "${method.name}"`);
    }
  }

  return info;
}

function interfaceTagInfo(int: Interface) {
  let interfaceType: InterfaceType | null = null;
  let autoContextBridge = false;
  const validators: string[] = [];

  for (const tag of int.tags) {
    if (tag.key === 'RendererAPI') {
      if (interfaceType !== null) throw new Error(`Interface ${int.name} declared as multiple different API types`);
      interfaceType = InterfaceType.RendererAPI;
    } else if (tag.key === 'BroadcastAPI') {
      if (interfaceType !== null) throw new Error(`Interface ${int.name} declared as multiple different API types`);
      interfaceType = InterfaceType.BroadcastAPI;
    } else if (tag.key === 'ContextBridge') {
      autoContextBridge = true;
    } else if (tag.key === 'Validator') {
      if (!tag.value) {
        throw new Error(`Value not provided with "Validator" tag on interface "${int.name}"`);
      }
      validators.push(tag.value);
    } else {
      throw new Error(`Unrecognized tag "${tag.key}" on interface "${int.name}"`);
    }
  }

  if (interfaceType === null) {
    throw new Error(`Interface ${int.name} does not have a declared API type of either [RendererAPI] or [BroadcastAPI]`);
  }

  if (validators.length === 0) {
    throw new Error(`Interface ${int.name} does not have a declared Validator, this is required for security reasons`);
  }

  return {
    interfaceType,
    autoContextBridge,
    validators,
  };
}

function methodReturn(method: InterfaceMethod, syncMeansNoPromise = false) {
  const inner = method.returns === null ? 'void' : method.returns;
  const info = methodTagInfo(method);
  if (syncMeansNoPromise && info.synchronous) {
    return inner;
  }
  return `Promise<${inner}> | ${inner}`;
}

export function wireInterface(int: Interface, controller: Controller, schema: Schema): void {
  const intInfo = interfaceTagInfo(int);

  if (intInfo.interfaceType === InterfaceType.RendererAPI) {
    const initializerName = `${INTERFACE_IMPL_PREFIX}_init_${int.name}`;
    const interfaceImplementation = [
      `export const ${int.name} = {`,
      `  setImplementation: (impl: I${int.name}Impl, ipc: Electron.IpcMain = ipcMain) => {`,
      ...int.methods.map((method) => {
        const tags = methodTagInfo(method);
        return [
          `ipc.${tags.synchronous ? 'removeAllListeners' : 'removeHandler'}('${ipcMessage(schema, int, method)}');`,
          `ipc.${tags.synchronous ? 'on' : 'handle'}('${ipcMessage(schema, int, method)}', async (event${method.arguments.length ? ', ' : ''}${method.arguments
            .map((arg) => `arg_${arg.name}: ${arg.argType}`)
            .join(', ')}) => {`,
          `  if (!(${intInfo.validators.map((v) => `(${eventValidator(v)}(event))`).join(' && ')})) {`,
          `    throw new Error(\`Incoming "${method.name}" call on interface "${int.name}" from \'$\{event.senderFrame?.url}\' did not pass origin validation\`);`,
          '  }',
          ...method.arguments.map(
            (arg, index) =>
              `  if (!${validatorFnOrPrimitiveValidator(arg.argType, `arg_${arg.name}`)}) throw new Error('Argument "${arg.name}" at position ${index} to method "${
                method.name
              }" in interface "${int.name}" failed to pass validation');`,
          ),
          `  ${method.returns === null ? '' : 'const result = '}await impl.${method.name}(${method.arguments.map((arg) => `arg_${arg.name}`).join(', ')});`,
          ...(method.returns === null
            ? []
            : [
                `  if (!${validatorFnOrPrimitiveValidator(method.returns, 'result')}) throw new Error('Result from method "${method.name}" in interface "${
                  int.name
                }" failed to pass validation');`,
                // TODO: Better error handling for the sync case (try/catch, { result, error } return value)
                tags.synchronous ? '  event.returnValue = result;' : '  return result;',
              ]),
          `});`,
        ].join('\n');
      }),
      '  }',
      '}',
    ];

    const interfaceDefinition = [
      `export interface I${int.name}Impl {`,
      ...int.methods.map((method) => `  ${method.name}(${method.arguments.map((arg) => `${arg.name}: ${arg.argType}`).join(', ')}): ${methodReturn(method)};`),
      '}',
      `export interface I${int.name}Renderer {`,
      ...int.methods.map((method) => `  ${method.name}(${method.arguments.map((arg) => `${arg.name}: ${arg.argType}`).join(', ')}): ${methodReturn(method, true)};`),
      '}',
    ];

    const rendererDefinition = [
      `export const ${int.name}: I${int.name}Renderer = {`,
      ...int.methods.map((method) => {
        const info = methodTagInfo(method);
        return [
          `  ${method.name}(${method.arguments.map((arg) => `${arg.name}: ${arg.argType}`).join(', ')}) {`,
          ...[
            `return ipcRenderer.${info.synchronous ? 'sendSync' : 'invoke'}('${ipcMessage(schema, int, method)}'${method.arguments.length ? ', ' : ''}${method.arguments
              .map((arg) => `${arg.name}`)
              .join(', ')})`,
          ].map((s) => `    ${s}`),
          '  },',
        ].join('\n');
      }),
      '}',
      ...(intInfo.autoContextBridge
        ? [
            `const ${initializerName} = (localBridged: Record<string, any>) => {`,
            `  if (!(${intInfo.validators.map((v) => `(${eventValidator(v)}())`).join(' && ')})) return;`,
            `  localBridged['${schema.name}'] = localBridged['${schema.name}'] || {};`,
            `  localBridged['${schema.name}']['${int.name}'] = ${int.name}`,
            '};',
          ]
        : []),
    ];

    if (intInfo.autoContextBridge) {
      controller.addPreloadBridgeInitializer(initializerName);
      controller.addPreloadBridgeKeyAndType(schema.name, int.name, `I${int.name}Renderer`);
    }

    controller.addCommonCode(interfaceDefinition.join('\n'));
    controller.addBrowserCode(interfaceImplementation.join('\n'));
    controller.addPreloadCode(rendererDefinition.join('\n'));
    controller.addPublicBrowserExport(int.name);
    controller.addPublicPreloadExport(int.name);
    controller.addCommonExport(`I${int.name}Impl`);
    controller.addPublicCommonExport(`I${int.name}Impl`);
    controller.addCommonExport(`I${int.name}Renderer`);
    controller.addPublicCommonExport(`I${int.name}Renderer`);
  }
}
