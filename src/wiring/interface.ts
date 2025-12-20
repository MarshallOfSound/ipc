import { Controller } from '../controller';
import { Array, Identifier, IdentifierIDX, Interface, InterfaceMethod, MethodArgument, Schema, Structure } from '../schema-type';
import { basePrimitives, eventValidator, INTERFACE_IMPL_PREFIX, ipcMessage, ipcStoreMessage, validator } from './_constants';
import { getTSForIdentifier } from './identifier';

enum InterfaceType {
  RendererAPI,
}

type MethodTagInfo = {
  synchronous: boolean;
  event: boolean;
  notImplemented: boolean;
  store: boolean;
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
  if (info.event && method.returns !== null) {
    throw new Error(`Method "${method.name}" is tagged with [Event] but has a return type. Events must not have return types.`);
  }

  if (info.store && (info.synchronous || info.event || info.notImplemented)) {
    throw new Error(`Method "${method.name}" is tagged with [Store] but is also tagged with incompatible tags. Stores can only be stores.`);
  }

  if (info.store && method.arguments.length > 0) {
    throw new Error(`Method "${method.name}" is tagged with [Store] but has arguments. Store declarations must have no arguments.`);
  }

  if (info.store && method.returns === null) {
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

function storeType(method: InterfaceMethod) {
  const innerBase = method.returns ? getTSForIdentifier(method.returns.type) : null;
  const inner = method.returns === null ? 'void' : `${innerBase}${method.returns.nullable ? ' | null' : ''}`;

  return `IPCStore<${inner}>`;
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
        .filter((method) => {
          const info = methodTagInfo(method);
          return !info.event && !info.notImplemented && !info.store;
        })
        .map((method) => {
          const tags = methodTagInfo(method);
          if (tags.synchronous) {
            // Sync handlers need try/catch to avoid hanging on errors
            return [
              `        target.ipc.removeAllListeners('${ipcMessage(schema, int, method)}');`,
              `target.ipc.on('${ipcMessage(schema, int, method)}', async (event${method.arguments.length ? ', ' : ''}${method.arguments
                .map((arg) => `arg_${arg.name}: ${getTSForIdentifier(arg)}`)
                .join(', ')}) => {`,
              `  try {`,
              `    if (!(${intInfo.validators.map((v) => `(${eventValidator(v)}(event))`).join(' && ')})) {`,
              `      throw new Error(\`Incoming "${method.name}" call on interface "${int.name}" from \'$\{event.senderFrame?.url}\' did not pass origin validation\`);`,
              '    }',
              ...method.arguments.map(
                (arg, index) =>
                  `    if (!${validatorFnOrPrimitiveValidator(arg, `arg_${arg.name}`, arg.nullable, arg.optional)}) throw new Error('Argument "${arg.name}" at position ${index} to method "${
                    method.name
                  }" in interface "${int.name}" failed to pass validation');`,
              ),
              `    ${method.returns === null ? '' : 'const result = '}await impl.${method.name}(${method.arguments.map((arg) => `arg_${arg.name}`).join(', ')});`,
              ...(method.returns === null
                ? [`    event.returnValue = { result: undefined };`]
                : [
                    `    if (!${validatorFnOrPrimitiveValidator(method.returns.type, 'result', method.returns.nullable, false)}) throw new Error('Result from method "${method.name}" in interface "${
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
            `        target.ipc.removeHandler('${ipcMessage(schema, int, method)}');`,
            `target.ipc.handle('${ipcMessage(schema, int, method)}', async (event${method.arguments.length ? ', ' : ''}${method.arguments
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
          const returnValidator = method.returns ? validatorFnOrPrimitiveValidator(method.returns.type, 'result', method.returns.nullable, false) : 'true';
          return [
            // getState handler (async)
            [
              `        target.ipc.removeHandler('${ipcStoreMessage(schema, int, method, 'getState')}');`,
              `target.ipc.handle('${ipcStoreMessage(schema, int, method, 'getState')}', async (event) => {`,
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
              `        target.ipc.removeAllListeners('${ipcStoreMessage(schema, int, method, 'getStateSync')}');`,
              `target.ipc.on('${ipcStoreMessage(schema, int, method, 'getStateSync')}', async (event) => {`,
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
      // Store update dispatchers
      ...int.methods
        .filter((m) => methodTagInfo(m).store)
        .map((method) => {
          const innerBase = method.returns ? getTSForIdentifier(method.returns.type) : 'void';
          const inner = method.returns === null ? 'void' : `${innerBase}${method.returns.nullable ? ' | null' : ''}`;
          const stateValidator = method.returns ? validatorFnOrPrimitiveValidator(method.returns.type, 'state', method.returns.nullable, false) : 'true';
          return [
            `update${upFirst(method.name)}Store(state: ${inner}): void {`,
            `  if (!${stateValidator}) throw new Error('State passed to update${upFirst(method.name)}Store in interface "${int.name}" failed to pass validation');`,
            `  target.send('${ipcStoreMessage(schema, int, method, 'update')}', state)`,
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
            `  ${method.name}(${method.arguments.map((arg) => `${arg.name}${arg.optional ? '?' :''}: ${getTSForIdentifier(arg)}${arg.nullable ? ' | null' : ''}`).join(', ')}): ${methodReturn(method)};`,
        ),
      ...int.methods
        .filter((m) => methodTagInfo(m).store)
        .map((method) => {
          const innerBase = method.returns ? getTSForIdentifier(method.returns.type) : 'void';
          const inner = method.returns === null ? 'void' : `${innerBase}${method.returns.nullable ? ' | null' : ''}`;
          return `  getInitial${upFirst(method.name)}State(): Promise<${inner}> | ${inner};`;
        }),
      '}',
      `export interface I${int.name}Renderer {`,
      ...int.methods
        .filter((m) => !methodTagInfo(m).event && !methodTagInfo(m).store)
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
      ...int.methods
        .filter((m) => methodTagInfo(m).store)
        .map(
          (method) =>
            `  ${method.name}Store: ${storeType(method)}`,
        ),
      '}',
    ];

    const rendererDefinition = [
      `export const ${int.name}: Partial<I${int.name}Renderer> = {`,
      ...int.methods.filter((method) => {
        const info = methodTagInfo(method);
        return !info.notImplemented && !info.store;
      }).map((method) => {
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
        if (info.synchronous) {
          return [
            `  ${method.name}(${argsString}) {`,
            `    const response = ipcRenderer.sendSync('${ipcMessage(schema, int, method)}'${method.arguments.length ? ', ' : ''}${method.arguments.map((arg) => arg.name).join(', ')});`,
            `    if (response.error) throw new Error(response.error);`,
            `    return response.result;`,
            `  },`,
          ].join('\n');
        }
        return [
          `  ${method.name}(${argsString}) {`,
          `    return ipcRenderer.invoke('${ipcMessage(schema, int, method)}'${method.arguments.length ? ', ' : ''}${method.arguments.map((arg) => arg.name).join(', ')});`,
          '  },',
        ].join('\n');
      }),
      // Store implementations
      ...int.methods.filter((method) => methodTagInfo(method).store).map((method) => {
        const innerBase = method.returns ? getTSForIdentifier(method.returns.type) : 'void';
        const inner = method.returns === null ? 'void' : `${innerBase}${method.returns.nullable ? ' | null' : ''}`;
        return [
          `  ${method.name}Store: {`,
          `    getState(): Promise<${inner}> {`,
          `      return ipcRenderer.invoke('${ipcStoreMessage(schema, int, method, 'getState')}');`,
          `    },`,
          `    getStateSync(): ${inner} {`,
          `      const response = ipcRenderer.sendSync('${ipcStoreMessage(schema, int, method, 'getStateSync')}');`,
          `      if (response.error) throw new Error(response.error);`,
          `      return response.result;`,
          `    },`,
          `    onStateChange(fn: (newState: ${inner}) => void): () => void {`,
          `      const handler = (_e: unknown, newState: ${inner}) => fn(newState);`,
          `      ipcRenderer.on('${ipcStoreMessage(schema, int, method, 'update')}', handler);`,
          `      return () => { ipcRenderer.removeListener('${ipcStoreMessage(schema, int, method, 'update')}', handler); };`,
          `    },`,
          `  },`,
        ].join('\n');
      }),
      `}`,
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

    // Generate React hooks for stores
    const storeMethods = int.methods.filter((m) => methodTagInfo(m).store);
    if (storeMethods.length > 0 && intInfo.autoContextBridge) {
      // Add import for the renderer API
      controller.addRendererHooksCode(`import { ${int.name} } from '../../renderer/${schema.name}';`);

      for (const method of storeMethods) {
        const hookName = `use${upFirst(method.name)}Store`;
        const innerBase = method.returns ? getTSForIdentifier(method.returns.type) : 'void';
        const inner = method.returns === null ? 'void' : `${innerBase}${method.returns.nullable ? ' | null' : ''}`;

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
