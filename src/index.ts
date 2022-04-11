import * as fs from 'fs-extra';
import * as path from 'path';

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

  const schemaFiles = (await fs.readdir(opts.schemaFolder)).filter((schemaFile) => path.extname(schemaFile) === IPC_SCHEMA_EXTENSION);

  // Read all schema files
  const schemas: Schema[] = await Promise.all(
    schemaFiles.map(async (schemaFile) => {
      const fullPath = path.resolve(opts.schemaFolder, schemaFile);

      const contents = await fs.readFile(fullPath, 'utf8');
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
  if (await fs.pathExists(opts.wiringFolder)) {
    await fs.remove(opts.wiringFolder);
  }
  await fs.mkdirp(opts.wiringFolder);
  for (const parent of [opts.wiringFolder, path.resolve(opts.wiringFolder, '_internal')]) {
    for (const dir of ['browser', 'renderer', 'common']) {
      await fs.mkdirp(path.resolve(parent, dir));
    }
  }

  const flatSchemas = [...mergedSchemas.values()];

  for (const schema of flatSchemas) {
    const wiring = buildWiring(schema);

    await fs.writeFile(path.resolve(opts.wiringFolder, 'browser', `${schema.name}.ts`), wiring.browser.external);
    await fs.writeFile(path.resolve(opts.wiringFolder, 'renderer', `${schema.name}.ts`), wiring.renderer.external);
    await fs.writeFile(path.resolve(opts.wiringFolder, 'common', `${schema.name}.ts`), wiring.common.external);

    await fs.writeFile(path.resolve(opts.wiringFolder, '_internal', 'browser', `${schema.name}.ts`), wiring.browser.internal);
    await fs.writeFile(path.resolve(opts.wiringFolder, '_internal', 'renderer', `${schema.name}.ts`), wiring.renderer.internal);
    await fs.writeFile(path.resolve(opts.wiringFolder, '_internal', 'common', `${schema.name}.ts`), wiring.common.internal);
  }
}
