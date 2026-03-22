import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateWiring } from '../../src/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import esbuild from 'esbuild';

let tmpDir: string;
let wiringDir: string;
let schemaDir: string;

const schema = `module test.esbuild

validator Always = AND(
    is_main_frame is true
)

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface AppService {
    GetValue() -> string
    [Store]
    connection() -> string
}`;

beforeAll(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eipc-type-export-test-'));
  schemaDir = path.join(tmpDir, 'schema');
  wiringDir = path.join(tmpDir, 'ipc');
  await fs.promises.mkdir(schemaDir, { recursive: true });
  await fs.promises.writeFile(path.join(schemaDir, 'api.eipc'), schema);
  await generateWiring({ schemaFolder: schemaDir, wiringFolder: wiringDir });
});

afterAll(async () => {
  if (tmpDir) {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});

describe('esbuild bundling of generated barrel files', () => {
  it('bundles renderer barrel with type-only re-exports', async () => {
    // This is the exact scenario from issue #10:
    // The renderer barrel re-exports IAppServiceRenderer (a type) from the
    // internal module where it's imported via `import type`. Without `export type`,
    // esbuild strips the type import from the internal module and the re-export fails.
    const entryContent = `
      import { AppService } from './ipc/renderer/test.esbuild.js';
      import type { IAppServiceRenderer } from './ipc/renderer/test.esbuild.js';
      console.log(AppService);
      const x: IAppServiceRenderer | undefined = undefined;
    `;
    const entryPath = path.join(tmpDir, 'entry-renderer.ts');
    await fs.promises.writeFile(entryPath, entryContent);

    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      logLevel: 'silent',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.outputFiles).toHaveLength(1);
  });

  it('bundles renderer-hooks barrel with type-only re-exports', async () => {
    // The renderer-hooks barrel re-exports ConnectionStoreState (a type)
    // alongside useConnectionStore (a value function).
    const entryContent = `
      import { useConnectionStore } from './ipc/renderer-hooks/test.esbuild.js';
      import type { ConnectionStoreState } from './ipc/renderer-hooks/test.esbuild.js';
      console.log(useConnectionStore);
      const x: ConnectionStoreState | undefined = undefined;
    `;
    const entryPath = path.join(tmpDir, 'entry-hooks.ts');
    await fs.promises.writeFile(entryPath, entryContent);

    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      logLevel: 'silent',
      // The renderer-hooks code imports React, stub it out
      external: ['react'],
    });

    expect(result.errors).toHaveLength(0);
    expect(result.outputFiles).toHaveLength(1);
  });

  it('generated renderer barrel separates type and value exports', async () => {
    // Read the generated renderer barrel file and verify it uses `export type`
    // for interface types. This is the structural guarantee that prevents
    // the esbuild issue described in #10.
    const barrelPath = path.join(wiringDir, 'renderer', 'test.esbuild.ts');
    const barrelContent = await fs.promises.readFile(barrelPath, 'utf8');

    // Should have `export type { IAppServiceRenderer }` not `export { IAppServiceRenderer }`
    expect(barrelContent).toContain('export type { IAppServiceRenderer }');
    // Value export should NOT include the type
    expect(barrelContent).toMatch(/export \{[^}]*AppService[^}]*\}/);
    const valueExport = barrelContent.match(/export \{([^}]+)\}/)!;
    expect(valueExport[1]).not.toContain('IAppServiceRenderer');
  });

  it('generated renderer-hooks barrel separates type and value exports', async () => {
    const barrelPath = path.join(wiringDir, 'renderer-hooks', 'test.esbuild.ts');
    const barrelContent = await fs.promises.readFile(barrelPath, 'utf8');

    expect(barrelContent).toContain('export type { ConnectionStoreState }');
    const valueExport = barrelContent.match(/export \{([^}]+)\}/)!;
    expect(valueExport[1]).not.toContain('ConnectionStoreState');
    expect(valueExport[1]).toContain('useConnectionStore');
  });
});
