import { Controller } from '../controller.js';
import type { Argument, Interface, Method, Module, TypeReference } from '../language/generated/ast.js';
import { basePrimitives, BROWSER_RUNTIME, eventValidator, INTERFACE_IMPL_PREFIX, IPC_PREFIX_CONST, ipcMessageSuffix, ipcStoreMessageSuffix, validator } from './_constants.js';
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

/** Composes the browser-runtime validator expression for a type, e.g. `$eipc$.optional($eipc$.arrayOf($eipc$.string))`. */
function runtimeValidator(type: TypeReference, nullable: boolean, optional: boolean): string {
  const baseType = type.reference;
  let check = basePrimitives.includes(baseType) ? `${BROWSER_RUNTIME}.${baseType}` : validator(baseType);
  if (type.array) {
    check = `${BROWSER_RUNTIME}.arrayOf(${check})`;
  }
  if (nullable) {
    check = `${BROWSER_RUNTIME}.nullable(${check})`;
  }
  if (optional) {
    check = `${BROWSER_RUNTIME}.optional(${check})`;
  }
  return check;
}

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
      throw new Error(`Unknown tag "[${tag.key}]" on method "${method.name}".\n\n` + `Valid method tags: [Sync], [Event], [Store], [NotImplemented]`);
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
  const legacyAliases: string[] = [];

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
    } else if (tag.key === 'LegacyAlias') {
      if (!tag.value) {
        throw new Error(`Value not provided with "LegacyAlias" tag on interface "${int.name}"`);
      }
      legacyAliases.push(tag.value);
    } else {
      throw new Error(
        `Unknown tag "[${tag.key}]" on interface "${int.name}".\n\n` + `Valid interface tags: [RendererAPI], [ContextBridge], [Validator=ValidatorName], [LegacyAlias=OldName]`,
      );
    }
  }

  if (interfaceType === null) {
    throw new Error(
      `Interface "${int.name}" is missing an API type.\n\n` +
        `Add [RendererAPI] before the interface declaration:\n\n` +
        `  [RendererAPI]\n` +
        `  [Validator=YourValidator]\n` +
        `  [ContextBridge]\n` +
        `  interface ${int.name} { ... }`,
    );
  }

  if (validators.length === 0) {
    throw new Error(
      `Interface "${int.name}" is missing a Validator.\n\n` +
        `Every interface requires a validator for security. Add [Validator=...] before the interface:\n\n` +
        `  [RendererAPI]\n` +
        `  [Validator=YourValidator]\n` +
        `  [ContextBridge]\n` +
        `  interface ${int.name} { ... }\n\n` +
        `See the Security Best Practices guide for validator patterns.`,
    );
  }

  return {
    interfaceType,
    autoContextBridge,
    validators,
    legacyAliases,
  };
}

// Local used inside emitted preload closures; $$-wrapped like the other
// generated identifiers so it cannot collide with schema argument names.
const CHANNEL = '$$channel$$';

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

type InterfaceTagInfo = ReturnType<typeof interfaceTagInfo>;

function dispatcherArgs(args: Argument[]) {
  return args.map((arg) => `arg_${arg.name}${arg.optional ? '?' : ''}: ${getArgTypeString(arg)}${arg.nullable ? ' | null' : ''}`).join(', ');
}

/**
 * Emits the browser-process side of an interface as data for the shared
 * browser runtime (templates/browser-runtime.ts): a typed defineInterface()
 * call with one row per method, store and event, plus the I<Name>Dispatcher
 * type describing what setImplementation() returns. Row names are type-checked
 * against I<Name>Impl / I<Name>Renderer / I<Name>Dispatcher by the runtime's
 * signature. The runtime owns channel names, validation order and error text,
 * so none of that is repeated per handler here.
 */
function browserImplementation(int: Interface, intInfo: InterfaceTagInfo): string[] {
  const plainMethods = int.methods.filter((method) => {
    const info = methodTagInfo(method);
    return !info.event && !info.notImplemented && !info.store;
  });
  const storeMethods = int.methods.filter((method) => methodTagInfo(method).store);
  const eventMethods = int.methods.filter((method) => {
    const info = methodTagInfo(method);
    return info.event && !info.notImplemented;
  });

  const argsRow = (args: Argument[]) => `[${args.map((arg) => `['${arg.name}', ${runtimeValidator(arg.type, arg.nullable, arg.optional)}]`).join(', ')}]`;
  const methodRow = (method: Method) => {
    const row = [`'${method.name}'`, argsRow(method.arguments)];
    const sync = methodTagInfo(method).synchronous;
    if (method.returnType) {
      row.push(runtimeValidator(method.returnType.type, method.returnType.nullable, false));
    } else if (sync) {
      row.push('null');
    }
    if (sync) {
      row.push("'sync'");
    }
    return `[${row.join(', ')}]`;
  };
  const storeRow = (method: Method) => `['${method.name}', ${runtimeValidator(method.returnType!.type, method.returnType!.nullable, false)}]`;
  const eventRow = (event: Method) => `['${event.name}', ${argsRow(event.arguments)}]`;
  const rows = (key: string, entries: string[]) => (entries.length === 0 ? [] : [`  ${key}: [`, ...entries.map((entry) => `    ${entry},`), '  ],']);

  // A single [Validator] is passed by reference; several are and-ed together.
  const origin =
    intInfo.validators.length === 1
      ? eventValidator(intInfo.validators[0])
      : `(event: ${BROWSER_RUNTIME}.IncomingEvent) => ${intInfo.validators.map((v) => `${eventValidator(v)}(event)`).join(' && ')}`;

  const dispatcherType = `I${int.name}Dispatcher`;
  return [
    `export interface ${dispatcherType} {`,
    ...eventMethods.map((event) => `  dispatch${upFirst(event.name)}(${dispatcherArgs(event.arguments)}): void;`),
    ...storeMethods.map(
      (method) => `  update${upFirst(method.name)}Store(state: ${getTSForTypeReference(method.returnType!.type)}${method.returnType!.nullable ? ' | null' : ''}): void;`,
    ),
    '}',
    `export const ${int.name} = /*#__PURE__*/ ${BROWSER_RUNTIME}.defineInterface<I${int.name}Impl, I${int.name}Renderer, ${dispatcherType}>(${IPC_PREFIX_CONST}, '${int.name}', ${origin}, {`,
    ...rows('methods', plainMethods.map(methodRow)),
    ...rows('stores', storeMethods.map(storeRow)),
    ...rows('events', eventMethods.map(eventRow)),
    '});',
  ];
}

export function wireInterface(int: Interface, module: Module, allowedTypes: Set<string>, controller: Controller): void {
  const intInfo = interfaceTagInfo(int);

  if (intInfo.interfaceType === InterfaceType.RendererAPI) {
    const initializerName = `${INTERFACE_IMPL_PREFIX}_init_${int.name}`;
    // Preload channel expressions: the per-module prefix is emitted once as a
    // const at the top of the file, each call site appends its own suffix.
    const channel = (method: Method) => `${IPC_PREFIX_CONST} + '${ipcMessageSuffix(int, method)}'`;
    const storeChannel = (method: Method, op: 'getState' | 'getStateSync' | 'update') => `${IPC_PREFIX_CONST} + '${ipcStoreMessageSuffix(int, method, op)}'`;

    const interfaceImplementation = browserImplementation(int, intInfo);

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
              `    const ${CHANNEL} = ${channel(method)};`,
              `    ipcRenderer.on(${CHANNEL}, handler)`,
              `    return () => { ipcRenderer.removeListener(${CHANNEL}, handler); };`,
              `  },`,
            ].join('\n');
          }
          if (info.synchronous) {
            return [
              `  ${method.name}(${argsString}) {`,
              `    const response = ipcRenderer.sendSync(${channel(method)}${method.arguments.length ? ', ' : ''}${method.arguments.map((arg) => arg.name).join(', ')});`,
              `    if (response.error) throw new Error(response.error);`,
              `    return response.result;`,
              `  },`,
            ].join('\n');
          }
          return [
            `  ${method.name}(${argsString}) {`,
            `    return ipcRenderer.invoke(${channel(method)}${method.arguments.length ? ', ' : ''}${method.arguments.map((arg) => arg.name).join(', ')});`,
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
            `      return ipcRenderer.invoke(${storeChannel(method, 'getState')});`,
            `    },`,
            `    getStateSync(): ${inner} {`,
            `      const response = ipcRenderer.sendSync(${storeChannel(method, 'getStateSync')});`,
            `      if (response.error) throw new Error(response.error);`,
            `      return response.result;`,
            `    },`,
            `    onStateChange(fn: (newState: ${inner}) => void): () => void {`,
            `      const handler = (_e: unknown, newState: ${inner}) => fn(newState);`,
            `      const ${CHANNEL} = ${storeChannel(method, 'update')};`,
            `      ipcRenderer.on(${CHANNEL}, handler);`,
            `      return () => { ipcRenderer.removeListener(${CHANNEL}, handler); };`,
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
    controller.addBrowserTypeExport(`I${int.name}Dispatcher`);
    controller.addPreloadExport(int.name);
    controller.addCommonExport(`I${int.name}Impl`);
    controller.addCommonExport(`I${int.name}Renderer`);

    controller.addRendererCode(`import type { I${int.name}Renderer } from '../../common/${module.name}.js';`);
    if (intInfo.legacyAliases.length > 0) {
      const lookups = [int.name, ...intInfo.legacyAliases].map((n) => `(globalThis as any)['${module.name}']?.['${n}']`).join(' || ');
      controller.addRendererCode(`export const ${int.name} = (${lookups}) as Partial<I${int.name}Renderer> | undefined;`);
    } else {
      controller.addRendererCode(`export const ${int.name} = (globalThis as any)['${module.name}']?.['${int.name}'] as Partial<I${int.name}Renderer> | undefined;`);
    }
    controller.addRendererExport(int.name);
    controller.addRendererTypeExport(`I${int.name}Renderer`);

    // Generate React hooks for stores
    const storeMethods = int.methods.filter((m) => methodTagInfo(m).store);
    if (storeMethods.length > 0 && intInfo.autoContextBridge) {
      // Collect non-primitive return types from store methods for import
      const storeReturnTypes = new Set<string>();
      for (const method of storeMethods) {
        if (method.returnType) {
          const baseType = method.returnType.type.reference;
          if (!basePrimitives.includes(baseType)) {
            storeReturnTypes.add(baseType);
          }
        }
      }

      // Import the interface type and any store return types from common
      const importTypes = [`I${int.name}Renderer`, ...storeReturnTypes].join(', ');
      controller.addRendererHooksCode(`import type { ${importTypes} } from '../../common/${module.name}.js';`);
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
        controller.addRendererHooksTypeExport(`${upFirst(method.name)}StoreState`);
      }
    }
  }
}
