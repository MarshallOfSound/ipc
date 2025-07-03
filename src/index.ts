import * as fs from 'node:fs';
import * as path from 'node:path';

import { getParser } from './parser';
import { Schema } from './schema-type';
import { buildWiring } from './wire';

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
  const parser = await getParser();

  const schemaFiles = (await fs.promises.readdir(opts.schemaFolder)).filter((schemaFile) => path.extname(schemaFile) === IPC_SCHEMA_EXTENSION);

  // Read all schema files
  const schemas: Schema[] = await Promise.all(
    schemaFiles.map(async (schemaFile) => {
      const fullPath = path.resolve(opts.schemaFolder, schemaFile);

      const contents = await fs.promises.readFile(fullPath, 'utf8');
      return parser.parse(contents);
    }),
  );

  // Merge schema files in the same module namespace
  const mergedSchemas: Map<string, Schema> = new Map();
  for (const schema of schemas) {
    if (mergedSchemas.has(schema.name)) {
      mergedSchemas.get(schema.name)!.body.push(...schema.body);
    } else {
      mergedSchemas.set(schema.name, schema);
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
    for (const dir of ['browser', 'preload', 'renderer', 'common', 'common-runtime']) {
      await fs.promises.mkdir(path.resolve(parent, dir), {
        recursive: true,
      });
    }
  }

  const flatSchemas = [...mergedSchemas.values()];

  for (const schema of flatSchemas) {
    const wiring = buildWiring(schema);

    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'browser', `${schema.name}.ts`), disableEslint(wiring.browser.external));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'preload', `${schema.name}.ts`), disableEslint(wiring.preload.external));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'renderer', `${schema.name}.ts`), disableEslint(wiring.renderer.external));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'common', `${schema.name}.ts`), disableEslint(wiring.common.external));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, 'common-runtime', `${schema.name}.ts`), disableEslint(wiring.commonRuntime.external));

    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'browser', `${schema.name}.ts`), disableEslint(wiring.browser.internal));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'preload', `${schema.name}.ts`), disableEslint(wiring.preload.internal));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'renderer', `${schema.name}.ts`), disableEslint(wiring.renderer.internal));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'common', `${schema.name}.ts`), disableEslint(wiring.common.internal));
    await fs.promises.writeFile(path.resolve(opts.wiringFolder, '_internal', 'common-runtime', `${schema.name}.ts`), disableEslint(wiring.commonRuntime.internal));
  }
}

function disableEslint(content: string): string {
  return `/* eslint-disable */

${content}`;
}
