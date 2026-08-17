import type { Interface, Method, Module } from '../language/generated/ast.js';

export const INLINE_STRUCTURE_JOINER = '_$inline$_';
export const INTERFACE_IMPL_PREFIX = '$eipc_impl$_';
export const VALIDATOR_PREFIX = '$eipc_validator$_';
export const EVENT_VALIDATOR_PREFIX = '$eipc_event_validator$_';
// Identifiers the generated browser / preload files use for the runtime
// namespace import and the per-module channel prefix constant.
export const BROWSER_RUNTIME = '$eipc$';
export const IPC_PREFIX_CONST = '$$ipcPrefix$$';
// This randomization just serves to make it harder to target multiple app versions
// / multiple apps as even if they have identical interfaces the IPC message
// channels will be different per build (please note that this isn't a runtime
// changeable prefix, rather this configures the hard coded prefix in each built
// interface file)
export const IPC_MESSAGE_PREFIX = `$eipc_message$_${crypto.randomUUID()}_$_`;

// Channel grammar: <IPC_MESSAGE_PREFIX><module>_$_<Interface>_$_<method>, with
// _$store$_<op> appended for store traffic. Generated files emit ipcModulePrefix
// once (as IPC_PREFIX_CONST) and append the interface/method parts, so the two
// sides must agree - browser-wiring.test.ts checks that they do.
export const IPC_CHANNEL_SEPARATOR = '_$_';
export const IPC_STORE_CHANNEL = '_$store$_';
export const ipcModulePrefix = (module: Module) => `${IPC_MESSAGE_PREFIX}${module.name}${IPC_CHANNEL_SEPARATOR}`;
/** The part of a method's channel after ipcModulePrefix, e.g. `Things_$_Find`. */
export const ipcMessageSuffix = (int: Interface, method: Method) => `${int.name}${IPC_CHANNEL_SEPARATOR}${method.name}`;
export const ipcStoreMessageSuffix = (int: Interface, method: Method, suffix: 'getState' | 'getStateSync' | 'update') =>
  `${ipcMessageSuffix(int, method)}${IPC_STORE_CHANNEL}${suffix}`;
export const ipcMessage = (module: Module, int: Interface, method: Method) => `${ipcModulePrefix(module)}${ipcMessageSuffix(int, method)}`;
export const ipcStoreMessage = (module: Module, int: Interface, method: Method, suffix: 'getState' | 'getStateSync' | 'update') =>
  `${ipcModulePrefix(module)}${ipcStoreMessageSuffix(int, method, suffix)}`;
export const validator = (symbolName: string) => `${VALIDATOR_PREFIX}${symbolName}`;
export const eventValidator = (validatorName: string) => `${EVENT_VALIDATOR_PREFIX}${validatorName}`;

export type BasePrimitive = 'string' | 'number' | 'boolean' | 'unknown';
export const basePrimitives = ['string', 'number', 'boolean', 'unknown'];
