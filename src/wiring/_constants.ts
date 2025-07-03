import { Interface, InterfaceMethod, Schema } from '../schema-type';

export const INLINE_STRUCTURE_JOINER = '_$inline$_';
export const INTERFACE_IMPL_PREFIX = '$eipc_impl$_';
export const VALIDATOR_PREFIX = '$eipc_validator$_';
export const EVENT_VALIDATOR_PREFIX = '$eipc_event_validator$_';
// This randomization just serves to make it harder to target multiple app versions
// / multiple apps as even if they have identical interfaces the IPC message
// channels will be different per build (please note that this isn't a runtime
// changeable prefix, rather this configures the hard coded prefix in each built
// interface file)
export const IPC_MESSAGE_PREFIX = `$eipc_message$_${crypto.randomUUID()}_$_`;

export const ipcMessage = (schema: Schema, int: Interface, method: InterfaceMethod) => `${IPC_MESSAGE_PREFIX}${schema.name}_$_${int.name}_$_${method.name}`;
export const validator = (symbolName: string) => `${VALIDATOR_PREFIX}${symbolName}`;
export const eventValidator = (validatorName: string) => `${EVENT_VALIDATOR_PREFIX}${validatorName}`;

export type BasePrimitive = 'string' | 'number' | 'boolean' | 'unknown';
export const basePrimitives = ['string', 'number', 'boolean', 'unknown'];
