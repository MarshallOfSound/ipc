import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateWiring } from '../src/index.js';

const SCHEMA_A = `module foo

validator Always = AND(
  is_main_frame is true
)

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface FromA {
  fromA() -> string
}
`;

const SCHEMA_B = `module foo

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface FromB {
  fromB() -> string
}
`;

describe('generateWiring with nested schema directories', () => {
  let tempDir: string;
  let schemaFolder: string;
  let wiringFolder: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eipc-nested-test-'));
    schemaFolder = path.join(tempDir, 'schema');
    wiringFolder = path.join(tempDir, 'wiring');
    await fs.promises.mkdir(path.join(schemaFolder, 'foo'), { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('picks up schema files from nested subdirectories', async () => {
    await fs.promises.writeFile(path.join(schemaFolder, 'foo', 'a.eipc'), SCHEMA_A);
    await fs.promises.writeFile(path.join(schemaFolder, 'foo', 'b.eipc'), SCHEMA_B);

    await generateWiring({ schemaFolder, wiringFolder });

    const internal = await fs.promises.readFile(path.join(wiringFolder, '_internal', 'browser', 'foo.ts'), 'utf8');
    expect(internal).toContain('FromA');
    expect(internal).toContain('FromB');
  });

  it('produces deterministic output across runs regardless of readdir order', async () => {
    await fs.promises.writeFile(path.join(schemaFolder, 'foo', 'a.eipc'), SCHEMA_A);
    await fs.promises.writeFile(path.join(schemaFolder, 'foo', 'b.eipc'), SCHEMA_B);

    await generateWiring({ schemaFolder, wiringFolder });
    const firstRun = await fs.promises.readFile(path.join(wiringFolder, '_internal', 'browser', 'foo.ts'), 'utf8');

    // Re-create the schema files in reverse order to perturb any "natural"
    // readdir ordering that might otherwise hide a sort bug.
    await fs.promises.unlink(path.join(schemaFolder, 'foo', 'a.eipc'));
    await fs.promises.unlink(path.join(schemaFolder, 'foo', 'b.eipc'));
    await fs.promises.writeFile(path.join(schemaFolder, 'foo', 'b.eipc'), SCHEMA_B);
    await fs.promises.writeFile(path.join(schemaFolder, 'foo', 'a.eipc'), SCHEMA_A);

    await generateWiring({ schemaFolder, wiringFolder });
    const secondRun = await fs.promises.readFile(path.join(wiringFolder, '_internal', 'browser', 'foo.ts'), 'utf8');

    expect(secondRun).toBe(firstRun);
  });
});
