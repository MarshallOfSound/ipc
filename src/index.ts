import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseEipc, formatParseError, type ParseError } from './language/parser.js';
import type { Module } from './language/generated/ast.js';
import { buildWiring } from './wire.js';

interface WiringOptions {
  /**
   * Absolute path to a folder containing valid ".eipc" schema files, every file
   * in this folder will be parsed and will be used to generate the wiring folder
   */
  schemaFolder: string;
  /**
   * Absolute path to a folder (does not have to already exist), if it exists it will
   * be completely wiped.  This method will fail if we detect a file in this folder
   * that was not created by this tool.
   */
  wiringFolder: string;
}

const IPC_SCHEMA_EXTENSION = '.eipc';

export async function generateWiring(opts: WiringOptions) {
  const schemaFiles = (await fs.promises.readdir(opts.schemaFolder)).filter((schemaFile) => path.extname(schemaFile) === IPC_SCHEMA_EXTENSION);

  // Read and parse all schema files
  const modules: Module[] = [];

  for (const schemaFile of schemaFiles) {
    const fullPath = path.resolve(opts.schemaFolder, schemaFile);
    const contents = await fs.promises.readFile(fullPath, 'utf8');

    const result = await parseEipc(contents, schemaFile);

    if (result.errors.length > 0) {
      const firstError = result.errors[0];
      throw new Error(formatParseError(firstError, schemaFile, contents));
    }

    modules.push(result.ast);
  }

  // Merge schema files in the same module namespace
  const mergedModules: Map<string, Module> = new Map();
  for (const module of modules) {
    if (mergedModules.has(module.name)) {
      mergedModules.get(module.name)!.elements.push(...module.elements);
    } else {
      mergedModules.set(module.name, module);
    }
  }

  // TODO: Validate existing wiringFolder contents
  if (fs.existsSync(opts.wiringFolder)) {
    await fs.promises.rm(opts.wiringFolder, {
      recursive: true,
    });
  }
  await fs.promises.mkdir(opts.wiringFolder, {
    recursive: true,
  });
  for (const parent of [opts.wiringFolder, path.resolve(opts.wiringFolder, '_internal')]) {
    for (const dir of ['browser', 'preload', 'renderer', 'renderer-hooks', 'common', 'common-runtime']) {
      await fs.promises.mkdir(path.resolve(parent, dir), {
        recursive: true,
      });
    }
  }

  const flatModules = [...mergedModules.values()];

  for (const module of flatModules) {
    const wiring = buildWiring(module);

    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'browser', `${module.name}.ts`), disableEslint(wiring.browser.external));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'preload', `${module.name}.ts`), disableEslint(wiring.preload.external));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'renderer', `${module.name}.ts`), disableEslint(wiring.renderer.external));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'renderer-hooks', `${module.name}.ts`), disableEslint(wiring.rendererHooks.external));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'common', `${module.name}.ts`), disableEslint(wiring.common.external));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'common-runtime', `${module.name}.ts`), disableEslint(wiring.commonRuntime.external));

    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'browser', `${module.name}.ts`), disableEslint(wiring.browser.internal));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'preload', `${module.name}.ts`), disableEslint(wiring.preload.internal));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'renderer', `${module.name}.ts`), disableEslint(wiring.renderer.internal));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'renderer-hooks', `${module.name}.ts`), disableEslint(wiring.rendererHooks.internal));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'common', `${module.name}.ts`), disableEslint(wiring.common.internal));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'common-runtime', `${module.name}.ts`), disableEslint(wiring.commonRuntime.internal));
  }
}

function disableEslint(content: string): string {
  return `/* eslint-disable */

${content}`;
}
