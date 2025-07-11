import { Controller } from '../controller';
import { Array, Identifier, IdentifierIDX, Interface, InterfaceMethod, MethodArgument, Schema, Structure } from '../schema-type';
import { basePrimitives, eventValidator, INTERFACE_IMPL_PREFIX, ipcMessage, validator } from './_constants';
import { getTSForIdentifier } from './identifier';

enum InterfaceType {
  RendererAPI,
  BroadcastAPI,
}

type MethodTagInfo = {
  synchronous: boolean;
  event: boolean;
};

const validatorFnOrPrimitiveValidator = (type: Identifier | IdentifierIDX | Array | MethodArgument, argName: string, nullable: boolean, optional: boolean) => {
  if (type.type === 'Argument') {
    return validatorFnOrPrimitiveValidator(type.argType, argName, nullable, optional);
  }
  const baseType = type.name;
  let baseCheck = basePrimitives.includes(baseType) ? `(typeof ${argName} === '${baseType}')` : `${validator(baseType)}(${argName})`;
  if (baseType === 'unknown') {
    baseCheck = 'true';
  }
  if (type.type === 'Array') {
    baseCheck = `(Array.isArray(${argName}) && ${argName}.every(${argName} => ${baseCheck}))`;
  }
  if (nullable) {
    baseCheck = `(${argName} === null || (${baseCheck}))`;
  }
  if (optional) {
    baseCheck = `(${argName} === undefined || (${baseCheck}))`;
  }
  return baseCheck;
};

function methodTagInfo(method: InterfaceMethod) {
  const info: MethodTagInfo = {
    synchronous: false,
    event: false,
  };

  for (const tag of method.tags) {
    if (tag.key === 'Sync') {
      info.synchronous = true;
    } else if (tag.key === 'Event') {
      info.event = true;
    } else {
      throw new Error(`Unrecognized tag "${tag.key}" on method "${method.name}"`);
    }
  }

  // Validate that Event methods don't have return types
  if (info.event && method.returns !== null) {
    throw new Error(`Method "${method.name}" is tagged with [Event] but has a return type. Events must not have return types.`);
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

function upFirst(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}

function methodReturn(method: InterfaceMethod, rendererSide = false) {
  const innerBase = method.returns ? getTSForIdentifier(method.returns.type) : null;
  const inner = method.returns === null ? 'void' : `${innerBase}${method.returns.nullable ? ' | null' : ''}`;
  const info = methodTagInfo(method);
  if (rendererSide && info.synchronous) {
    return inner;
  }
  if (rendererSide) {
    return `Promise<${inner}>`;
  }
  return `Promise<${inner}> | ${inner}`;
}

export function wireInterface(int: Interface, controller: Controller, schema: Schema): void {
  const intInfo = interfaceTagInfo(int);

  if (intInfo.interfaceType === InterfaceType.RendererAPI) {
    const initializerName = `${INTERFACE_IMPL_PREFIX}_init_${int.name}`;
    const interfaceImplementation = [
      `const ${int.name}_dispatchers = new WeakMap<Electron.WebContents | Electron.WebFrameMain, ReturnType<ReturnType<typeof ${int.name}['for']>['setImplementation']>>()`,
      `export const ${int.name} = {`,
      `  getDispatcher(target: Electron.WebContents | Electron.WebFrameMain) {`,
      `    return ${int.name}_dispatchers.get(target);`,
      `  },`,
      `  for(target: Electron.WebContents | Electron.WebFrameMain) {`,
      `    return {`,
      `      setImplementation: (impl: I${int.name}Impl) => {`,
      ...int.methods
        .filter((method) => !methodTagInfo(method).event)
        .map((method) => {
          const tags = methodTagInfo(method);
          return [
            `        target.ipc.${tags.synchronous ? 'removeAllListeners' : 'removeHandler'}('${ipcMessage(schema, int, method)}');`,
            `target.ipc.${tags.synchronous ? 'on' : 'handle'}('${ipcMessage(schema, int, method)}', async (event${method.arguments.length ? ', ' : ''}${method.arguments
              .map((arg) => `arg_${arg.name}: ${getTSForIdentifier(arg)}`)
              .join(', ')}) => {`,
            `  if (!(${intInfo.validators.map((v) => `(${eventValidator(v)}(event))`).join(' && ')})) {`,
            `    throw new Error(\`Incoming "${method.name}" call on interface "${int.name}" from \'$\{event.senderFrame?.url}\' did not pass origin validation\`);`,
            '  }',
            ...method.arguments.map(
              (arg, index) =>
                `  if (!${validatorFnOrPrimitiveValidator(arg, `arg_${arg.name}`, arg.nullable, arg.optional)}) throw new Error('Argument "${arg.name}" at position ${index} to method "${
                  method.name
                }" in interface "${int.name}" failed to pass validation');`,
            ),
            `  ${method.returns === null ? '' : 'const result = '}await impl.${method.name}(${method.arguments.map((arg) => `arg_${arg.name}`).join(', ')});`,
            ...(method.returns === null
              ? []
              : [
                  `  if (!${validatorFnOrPrimitiveValidator(method.returns.type, 'result', method.returns.nullable, false)}) throw new Error('Result from method "${method.name}" in interface "${
                    int.name
                  }" failed to pass validation');`,
                  // TODO: Better error handling for the sync case (try/catch, { result, error } return value)
                  tags.synchronous ? '  event.returnValue = result;' : '  return result;',
                ]),
            `});`,
          ].join('\n        ');
        }),
      `        const dis = {`,
      ...int.methods
        .filter((m) => methodTagInfo(m).event)
        .map((event) =>
          [
            `dispatch${upFirst(event.name)}(${event.arguments.map((arg) => `arg_${arg.name}${arg.optional ? '?' :''}: ${getTSForIdentifier(arg)}${arg.nullable ? ' | null' : ''}`).join(', ')}): void {`,
            ...event.arguments.map(
              (arg, index) =>
                `  if (!${validatorFnOrPrimitiveValidator(arg, `arg_${arg.name}`, arg.nullable, arg.optional)}) throw new Error('Argument "${arg.name}" at position ${index} to event "${
                  event.name
                }" in interface "${int.name}" failed to pass validation');`,
            ),
            `  target.send('${ipcMessage(schema, int, event)}'${event.arguments.length > 0 ? ', ' : ''}${event.arguments.map((arg) => `arg_${arg.name}`).join(', ')})`,
            '},',
          ]
            .map((s) => `          ${s}`)
            .join('\n'),
        ),
      `        };`,
      `        ${int.name}_dispatchers.set(target, dis)`,
      `        return dis;`,
      '      }',
      `    };`,
      `  }`,
      '}',
    ];

    const interfaceDefinition = [
      `export interface I${int.name}Impl {`,
      ...int.methods
        .filter((m) => !methodTagInfo(m).event)
        .map(
          (method) =>
            `  ${method.name}(${method.arguments.map((arg) => `${arg.name}${arg.optional ? '?' :''}: ${getTSForIdentifier(arg)}${arg.nullable ? ' | null' : ''}`).join(', ')}): ${methodReturn(method)};`,
        ),
      '}',
      `export interface I${int.name}Renderer {`,
      ...int.methods
        .filter((m) => !methodTagInfo(m).event)
        .map(
          (method) =>
            `  ${method.name}(${method.arguments.map((arg) => `${arg.name}${arg.optional ? '?' :''}: ${getTSForIdentifier(arg)}${arg.nullable ? ' | null' : ''}`).join(', ')}): ${methodReturn(method, true)};`,
        ),
      ...int.methods
        .filter((m) => methodTagInfo(m).event)
        .map(
          (method) =>
            `  on${upFirst(method.name)}(fn: (${method.arguments.map((arg) => `${arg.name}${arg.optional ? '?' :''}: ${getTSForIdentifier(arg)}${arg.nullable ? ' | null' : ''}`).join(', ')}) => void): () => void;`,
        ),
      '}',
    ];

    const rendererDefinition = [
      `export const ${int.name}: I${int.name}Renderer = {`,
      ...int.methods.map((method) => {
        const info = methodTagInfo(method);
        const argsString = method.arguments.map((arg) => `${arg.name}${arg.optional ? '?' :''}: ${getTSForIdentifier(arg)}${arg.nullable ? ' | null' : ''}`).join(', ');

        if (info.event) {
          return [
            `  on${upFirst(method.name)}(fn: (${argsString}) => void) {`,
            `    const handler = (e: unknown, ${argsString}) => fn(${method.arguments.map((arg) => arg.name).join(', ')});`,
            `    ipcRenderer.on('${ipcMessage(schema, int, method)}', handler)`,
            `    return () => { ipcRenderer.removeListener('${ipcMessage(schema, int, method)}', handler); };`,
            `  },`,
          ].join('\n');
        }
        return [
          `  ${method.name}(${argsString}) {`,
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
