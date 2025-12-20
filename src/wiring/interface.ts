import { Controller } from '../controller.js';
import type { Argument, Interface, Method, Module, TypeReference } from '../language/generated/ast.js';
import { basePrimitives, eventValidator, INTERFACE_IMPL_PREFIX, ipcMessage, ipcStoreMessage, validator } from './_constants.js';
import { getTSForTypeReference } from './identifier.js';

enum InterfaceType {
  RendererAPI,
}

type MethodTagInfo = {
  synchronous: boolean;
  event: boolean;
  notImplemented: boolean;
  store: boolean;
};

const validatorFnOrPrimitiveValidator = (type: TypeReference, argName: string, nullable: boolean, optional: boolean): string => {
  const baseType = type.reference;
  let baseCheck = basePrimitives.includes(baseType) ? `(typeof ${argName} === '${baseType}')` : `${validator(baseType)}(${argName})`;
  if (baseType === 'unknown') {
    baseCheck = 'true';
  }
  if (type.array) {
    baseCheck = `(Array.isArray(${argName}) && ${argName}.every((v: any) => ${validatorFnOrPrimitiveValidator({ ...type, array: false } as TypeReference, 'v', false, false)}))`;
  }
  if (nullable) {
    baseCheck = `(${argName} === null || (${baseCheck}))`;
  }
  if (optional) {
    baseCheck = `(${argName} === undefined || (${baseCheck}))`;
  }
  return baseCheck;
};

function methodTagInfo(method: Method) {
  const info: MethodTagInfo = {
    synchronous: false,
    event: false,
    notImplemented: false,
    store: false,
  };

  for (const tag of method.tags) {
    if (tag.key === 'Sync') {
      info.synchronous = true;
    } else if (tag.key === 'Event') {
      info.event = true;
    } else if (tag.key === 'NotImplemented') {
      info.notImplemented = true;
    } else if (tag.key === 'Store') {
      info.store = true;
    } else {
      throw new Error(`Unrecognized tag "${tag.key}" on method "${method.name}"`);
    }
  }

  // Validate that Event methods don't have return types
  if (info.event && method.returnType !== undefined) {
    throw new Error(`Method "${method.name}" is tagged with [Event] but has a return type. Events must not have return types.`);
  }

  if (info.store && (info.synchronous || info.event || info.notImplemented)) {
    throw new Error(`Method "${method.name}" is tagged with [Store] but is also tagged with incompatible tags. Stores can only be stores.`);
  }

  if (info.store && method.arguments.length > 0) {
    throw new Error(`Method "${method.name}" is tagged with [Store] but has arguments. Store declarations must have no arguments.`);
  }

  if (info.store && method.returnType === undefined) {
    throw new Error(`Method "${method.name}" is tagged with [Store] but has no return type. Store declarations must specify the state type.`);
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
    throw new Error(`Interface ${int.name} does not have a declared API type of [RendererAPI]`);
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

function getArgTypeString(arg: Argument): string {
  return getTSForTypeReference(arg.type);
}

function methodReturn(method: Method, rendererSide = false) {
  const innerBase = method.returnType ? getTSForTypeReference(method.returnType.type) : null;
  const inner = method.returnType === undefined ? 'void' : `${innerBase}${method.returnType.nullable ? ' | null' : ''}`;
  const info = methodTagInfo(method);
  if (rendererSide && info.synchronous) {
    return inner;
  }
  if (rendererSide) {
    return `Promise<${inner}>`;
  }
  return `Promise<${inner}> | ${inner}`;
}

function storeType(method: Method) {
  const innerBase = method.returnType ? getTSForTypeReference(method.returnType.type) : null;
  const inner = method.returnType === undefined ? 'void' : `${innerBase}${method.returnType.nullable ? ' | null' : ''}`;

  return `IPCStore<${inner}>`;
}

export function wireInterface(int: Interface, module: Module, allowedTypes: Set<string>, controller: Controller): void {
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
        .filter((method) => {
          const info = methodTagInfo(method);
          return !info.event && !info.notImplemented && !info.store;
        })
        .map((method) => {
          const tags = methodTagInfo(method);
          if (tags.synchronous) {
            // Sync handlers need try/catch to avoid hanging on errors
            return [
              `        target.ipc.removeAllListeners('${ipcMessage(module, int, method)}');`,
              `target.ipc.on('${ipcMessage(module, int, method)}', async (event${method.arguments.length ? ', ' : ''}${method.arguments
                .map((arg) => `arg_${arg.name}: ${getArgTypeString(arg)}`)
                .join(', ')}) => {`,
              `  try {`,
              `    if (!(${intInfo.validators.map((v) => `(${eventValidator(v)}(event))`).join(' && ')})) {`,
              `      throw new Error(\`Incoming "${method.name}" call on interface "${int.name}" from \'$\{event.senderFrame?.url}\' did not pass origin validation\`);`,
              '    }',
              ...method.arguments.map(
                (arg, index) =>
                  `    if (!${validatorFnOrPrimitiveValidator(arg.type, `arg_${arg.name}`, arg.nullable, arg.optional)}) throw new Error('Argument "${arg.name}" at position ${index} to method "${
                    method.name
                  }" in interface "${int.name}" failed to pass validation');`,
              ),
              `    ${method.returnType === undefined ? '' : 'const result = '}await impl.${method.name}(${method.arguments.map((arg) => `arg_${arg.name}`).join(', ')});`,
              ...(method.returnType === undefined
                ? [`    event.returnValue = { result: undefined };`]
                : [
                    `    if (!${validatorFnOrPrimitiveValidator(method.returnType.type, 'result', method.returnType.nullable, false)}) throw new Error('Result from method "${method.name}" in interface "${
                      int.name
                    }" failed to pass validation');`,
                    `    event.returnValue = { result };`,
                  ]),
              `  } catch (err) {`,
              `    event.returnValue = { error: err instanceof Error ? err.message : String(err) };`,
              `  }`,
              `});`,
            ].join('\n        ');
          }
          // Async handlers
          return [
            `        target.ipc.removeHandler('${ipcMessage(module, int, method)}');`,
            `target.ipc.handle('${ipcMessage(module, int, method)}', async (event${method.arguments.length ? ', ' : ''}${method.arguments
              .map((arg) => `arg_${arg.name}: ${getArgTypeString(arg)}`)
              .join(', ')}) => {`,
            `  if (!(${intInfo.validators.map((v) => `(${eventValidator(v)}(event))`).join(' && ')})) {`,
            `    throw new Error(\`Incoming "${method.name}" call on interface "${int.name}" from \'$\{event.senderFrame?.url}\' did not pass origin validation\`);`,
            '  }',
            ...method.arguments.map(
              (arg, index) =>
                `  if (!${validatorFnOrPrimitiveValidator(arg.type, `arg_${arg.name}`, arg.nullable, arg.optional)}) throw new Error('Argument "${arg.name}" at position ${index} to method "${
                  method.name
                }" in interface "${int.name}" failed to pass validation');`,
            ),
            `  ${method.returnType === undefined ? '' : 'const result = '}await impl.${method.name}(${method.arguments.map((arg) => `arg_${arg.name}`).join(', ')});`,
            ...(method.returnType === undefined
              ? []
              : [
                  `  if (!${validatorFnOrPrimitiveValidator(method.returnType.type, 'result', method.returnType.nullable, false)}) throw new Error('Result from method "${method.name}" in interface "${
                    int.name
                  }" failed to pass validation');`,
                  '  return result;',
                ]),
            `});`,
          ].join('\n        ');
        }),
      // Store handlers (getState async and getStateSync)
      ...int.methods
        .filter((method) => methodTagInfo(method).store)
        .flatMap((method) => {
          const implMethodName = `getInitial${upFirst(method.name)}State`;
          const returnValidator = method.returnType ? validatorFnOrPrimitiveValidator(method.returnType.type, 'result', method.returnType.nullable, false) : 'true';
          return [
            // getState handler (async)
            [
              `        target.ipc.removeHandler('${ipcStoreMessage(module, int, method, 'getState')}');`,
              `target.ipc.handle('${ipcStoreMessage(module, int, method, 'getState')}', async (event) => {`,
              `  if (!(${intInfo.validators.map((v) => `(${eventValidator(v)}(event))`).join(' && ')})) {`,
              `    throw new Error(\`Incoming "${method.name}" store getState call on interface "${int.name}" from \'$\{event.senderFrame?.url}\' did not pass origin validation\`);`,
              '  }',
              `  const result = await impl.${implMethodName}();`,
              `  if (!${returnValidator}) throw new Error('Result from store "${method.name}" getInitialState in interface "${int.name}" failed to pass validation');`,
              `  return result;`,
              `});`,
            ].join('\n        '),
            // getStateSync handler (sync)
            [
              `        target.ipc.removeAllListeners('${ipcStoreMessage(module, int, method, 'getStateSync')}');`,
              `target.ipc.on('${ipcStoreMessage(module, int, method, 'getStateSync')}', async (event) => {`,
              `  try {`,
              `    if (!(${intInfo.validators.map((v) => `(${eventValidator(v)}(event))`).join(' && ')})) {`,
              `      throw new Error(\`Incoming "${method.name}" store getStateSync call on interface "${int.name}" from \'$\{event.senderFrame?.url}\' did not pass origin validation\`);`,
              '    }',
              `    const result = await impl.${implMethodName}();`,
              `    if (!${returnValidator}) throw new Error('Result from store "${method.name}" getInitialState in interface "${int.name}" failed to pass validation');`,
              `    event.returnValue = { result };`,
              `  } catch (err) {`,
              `    event.returnValue = { error: err instanceof Error ? err.message : String(err) };`,
              `  }`,
              `});`,
            ].join('\n        '),
          ];
        }),
      `        const dis = {`,
      ...int.methods
        .filter((m) => {
          const info = methodTagInfo(m);
          return info.event && !info.notImplemented;
        })
        .map((event) =>
          [
            `dispatch${upFirst(event.name)}(${event.arguments.map((arg) => `arg_${arg.name}${arg.optional ? '?' : ''}: ${getArgTypeString(arg)}${arg.nullable ? ' | null' : ''}`).join(', ')}): void {`,
            ...event.arguments.map(
              (arg, index) =>
                `  if (!${validatorFnOrPrimitiveValidator(arg.type, `arg_${arg.name}`, arg.nullable, arg.optional)}) throw new Error('Argument "${arg.name}" at position ${index} to event "${
                  event.name
                }" in interface "${int.name}" failed to pass validation');`,
            ),
            `  target.send('${ipcMessage(module, int, event)}'${event.arguments.length > 0 ? ', ' : ''}${event.arguments.map((arg) => `arg_${arg.name}`).join(', ')})`,
            '},',
          ]
            .map((s) => `          ${s}`)
            .join('\n'),
        ),
      // Store update dispatchers
      ...int.methods
        .filter((m) => methodTagInfo(m).store)
        .map((method) => {
          const innerBase = method.returnType ? getTSForTypeReference(method.returnType.type) : 'void';
          const inner = method.returnType === undefined ? 'void' : `${innerBase}${method.returnType.nullable ? ' | null' : ''}`;
          const stateValidator = method.returnType ? validatorFnOrPrimitiveValidator(method.returnType.type, 'state', method.returnType.nullable, false) : 'true';
          return [
            `update${upFirst(method.name)}Store(state: ${inner}): void {`,
            `  if (!${stateValidator}) throw new Error('State passed to update${upFirst(method.name)}Store in interface "${int.name}" failed to pass validation');`,
            `  target.send('${ipcStoreMessage(module, int, method, 'update')}', state)`,
            '},',
          ]
            .map((s) => `          ${s}`)
            .join('\n');
        }),
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
        .filter((m) => {
          const info = methodTagInfo(m);
          return !info.event && !info.notImplemented && !info.store;
        })
        .map(
          (method) =>
            `  ${method.name}(${method.arguments.map((arg) => `${arg.name}${arg.optional ? '?' : ''}: ${getArgTypeString(arg)}${arg.nullable ? ' | null' : ''}`).join(', ')}): ${methodReturn(method)};`,
        ),
      ...int.methods
        .filter((m) => methodTagInfo(m).store)
        .map((method) => {
          const innerBase = method.returnType ? getTSForTypeReference(method.returnType.type) : 'void';
          const inner = method.returnType === undefined ? 'void' : `${innerBase}${method.returnType.nullable ? ' | null' : ''}`;
          return `  getInitial${upFirst(method.name)}State(): Promise<${inner}> | ${inner};`;
        }),
      '}',
      `export interface I${int.name}Renderer {`,
      ...int.methods
        .filter((m) => !methodTagInfo(m).event && !methodTagInfo(m).store)
        .map(
          (method) =>
            `  ${method.name}(${method.arguments.map((arg) => `${arg.name}${arg.optional ? '?' : ''}: ${getArgTypeString(arg)}${arg.nullable ? ' | null' : ''}`).join(', ')}): ${methodReturn(method, true)};`,
        ),
      ...int.methods
        .filter((m) => methodTagInfo(m).event)
        .map(
          (method) =>
            `  on${upFirst(method.name)}(fn: (${method.arguments.map((arg) => `${arg.name}${arg.optional ? '?' : ''}: ${getArgTypeString(arg)}${arg.nullable ? ' | null' : ''}`).join(', ')}) => void): () => void;`,
        ),
      ...int.methods.filter((m) => methodTagInfo(m).store).map((method) => `  ${method.name}Store: ${storeType(method)}`),
      '}',
    ];

    const rendererDefinition = [
      `export const ${int.name}: Partial<I${int.name}Renderer> = {`,
      ...int.methods
        .filter((method) => {
          const info = methodTagInfo(method);
          return !info.notImplemented && !info.store;
        })
        .map((method) => {
          const info = methodTagInfo(method);
          const argsString = method.arguments.map((arg) => `${arg.name}${arg.optional ? '?' : ''}: ${getArgTypeString(arg)}${arg.nullable ? ' | null' : ''}`).join(', ');

          if (info.event) {
            return [
              `  on${upFirst(method.name)}(fn: (${argsString}) => void) {`,
              `    const handler = (e: unknown, ${argsString}) => fn(${method.arguments.map((arg) => arg.name).join(', ')});`,
              `    ipcRenderer.on('${ipcMessage(module, int, method)}', handler)`,
              `    return () => { ipcRenderer.removeListener('${ipcMessage(module, int, method)}', handler); };`,
              `  },`,
            ].join('\n');
          }
          if (info.synchronous) {
            return [
              `  ${method.name}(${argsString}) {`,
              `    const response = ipcRenderer.sendSync('${ipcMessage(module, int, method)}'${method.arguments.length ? ', ' : ''}${method.arguments.map((arg) => arg.name).join(', ')});`,
              `    if (response.error) throw new Error(response.error);`,
              `    return response.result;`,
              `  },`,
            ].join('\n');
          }
          return [
            `  ${method.name}(${argsString}) {`,
            `    return ipcRenderer.invoke('${ipcMessage(module, int, method)}'${method.arguments.length ? ', ' : ''}${method.arguments.map((arg) => arg.name).join(', ')});`,
            '  },',
          ].join('\n');
        }),
      // Store implementations
      ...int.methods
        .filter((method) => methodTagInfo(method).store)
        .map((method) => {
          const innerBase = method.returnType ? getTSForTypeReference(method.returnType.type) : 'void';
          const inner = method.returnType === undefined ? 'void' : `${innerBase}${method.returnType.nullable ? ' | null' : ''}`;
          return [
            `  ${method.name}Store: {`,
            `    getState(): Promise<${inner}> {`,
            `      return ipcRenderer.invoke('${ipcStoreMessage(module, int, method, 'getState')}');`,
            `    },`,
            `    getStateSync(): ${inner} {`,
            `      const response = ipcRenderer.sendSync('${ipcStoreMessage(module, int, method, 'getStateSync')}');`,
            `      if (response.error) throw new Error(response.error);`,
            `      return response.result;`,
            `    },`,
            `    onStateChange(fn: (newState: ${inner}) => void): () => void {`,
            `      const handler = (_e: unknown, newState: ${inner}) => fn(newState);`,
            `      ipcRenderer.on('${ipcStoreMessage(module, int, method, 'update')}', handler);`,
            `      return () => { ipcRenderer.removeListener('${ipcStoreMessage(module, int, method, 'update')}', handler); };`,
            `    },`,
            `  },`,
          ].join('\n');
        }),
      `}`,
      ...(intInfo.autoContextBridge
        ? [
            `const ${initializerName} = (localBridged: Record<string, any>) => {`,
            `  if (!(${intInfo.validators.map((v) => `(${eventValidator(v)}())`).join(' && ')})) return;`,
            `  localBridged['${module.name}'] = localBridged['${module.name}'] || {};`,
            `  localBridged['${module.name}']['${int.name}'] = ${int.name}`,
            '};',
          ]
        : []),
    ];

    if (intInfo.autoContextBridge) {
      controller.addPreloadBridgeInitializer(initializerName);
      controller.addPreloadBridgeKeyAndType(module.name, int.name, `I${int.name}Renderer`);
    }

    controller.addCommonCode(interfaceDefinition.join('\n'));
    controller.addBrowserCode(interfaceImplementation.join('\n'));
    controller.addPreloadCode(rendererDefinition.join('\n'));
    controller.addBrowserExport(int.name);
    controller.addPreloadExport(int.name);
    controller.addCommonExport(`I${int.name}Impl`);
    controller.addCommonExport(`I${int.name}Renderer`);

    // Generate React hooks for stores
    const storeMethods = int.methods.filter((m) => methodTagInfo(m).store);
    if (storeMethods.length > 0 && intInfo.autoContextBridge) {
      // Import the type from common and access the bridged implementation from globalThis
      controller.addRendererHooksCode(`import type { I${int.name}Renderer } from '../../common/${module.name}.js';`);
      controller.addRendererHooksCode(`const ${int.name} = (globalThis as any)['${module.name}']?.['${int.name}'] as Partial<I${int.name}Renderer> | undefined;`);

      for (const method of storeMethods) {
        const hookName = `use${upFirst(method.name)}Store`;
        const innerBase = method.returnType ? getTSForTypeReference(method.returnType.type) : 'void';
        const inner = method.returnType === undefined ? 'void' : `${innerBase}${method.returnType.nullable ? ' | null' : ''}`;

        const hookCode = [
          `export type ${upFirst(method.name)}StoreState =`,
          `  | { state: 'missing' }`,
          `  | { state: 'loading' }`,
          `  | { state: 'ready'; result: ${inner} }`,
          `  | { state: 'error'; error: Error };`,
          ``,
          `export function ${hookName}(): ${upFirst(method.name)}StoreState {`,
          `  const [storeState, setStoreState] = useState<${upFirst(method.name)}StoreState>(() => {`,
          `    if (!${int.name}?.${method.name}Store) {`,
          `      return { state: 'missing' };`,
          `    }`,
          `    return { state: 'loading' };`,
          `  });`,
          ``,
          `  useEffect(() => {`,
          `    const store = ${int.name}?.${method.name}Store;`,
          `    if (!store) return;`,
          ``,
          `    let cancelled = false;`,
          ``,
          `    store.getState()`,
          `      .then((result: ${inner}) => {`,
          `        if (!cancelled) {`,
          `          setStoreState({ state: 'ready', result });`,
          `        }`,
          `      })`,
          `      .catch((error: unknown) => {`,
          `        if (!cancelled) {`,
          `          setStoreState({ state: 'error', error: error instanceof Error ? error : new Error(String(error)) });`,
          `        }`,
          `      });`,
          ``,
          `    const unsubscribe = store.onStateChange((result: ${inner}) => {`,
          `      if (!cancelled) {`,
          `        setStoreState({ state: 'ready', result });`,
          `      }`,
          `    });`,
          ``,
          `    return () => {`,
          `      cancelled = true;`,
          `      unsubscribe();`,
          `    };`,
          `  }, []);`,
          ``,
          `  return storeState;`,
          `}`,
        ];

        controller.addRendererHooksCode(hookCode.join('\n'));
        controller.addRendererHooksExport(hookName);
        controller.addRendererHooksExport(`${upFirst(method.name)}StoreState`);
      }
    }
  }
}
