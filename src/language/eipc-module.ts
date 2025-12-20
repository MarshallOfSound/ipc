import {
  createDefaultCoreModule,
  createDefaultSharedCoreModule,
  type DefaultSharedCoreModuleContext,
  inject,
  type LangiumCoreServices,
  type LangiumSharedCoreServices,
  type Module,
  type PartialLangiumCoreServices,
} from 'langium';
import { EipcGeneratedModule, EipcGeneratedSharedModule } from './generated/module.js';

/**
 * Declaration of custom services
 */
export type EipcAddedServices = {
  // Add custom services here
};

/**
 * Union of Langium default services and custom services
 */
export type EipcServices = LangiumCoreServices & EipcAddedServices;

/**
 * Dependency injection module that overrides Langium default services
 */
export const EipcModule: Module<EipcServices, PartialLangiumCoreServices & EipcAddedServices> = {
  // Add custom service implementations here
};

/**
 * Create the full set of services required by Langium
 */
export function createEipcServices(context: DefaultSharedCoreModuleContext): {
  shared: LangiumSharedCoreServices;
  Eipc: EipcServices;
} {
  const shared = inject(createDefaultSharedCoreModule(context), EipcGeneratedSharedModule);
  const Eipc = inject(createDefaultCoreModule({ shared }), EipcGeneratedModule, EipcModule);
  shared.ServiceRegistry.register(Eipc);
  return { shared, Eipc };
}
