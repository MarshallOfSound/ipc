import path from 'path';
import { fileURLToPath } from 'url';
import { generateWiring } from '../../../dist/index.js';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function build() {
  // Generate the IPC wiring
  await generateWiring({
    schemaFolder: __dirname,
    wiringFolder: path.join(__dirname, 'ipc'),
  });
  console.log('E2E test app IPC wiring generated');

  // Bundle the preload ESM for sandbox=off
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'preload.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: path.join(__dirname, 'dist', 'preload.mjs'),
    external: ['electron', 'electron/renderer'],
    format: 'esm',
  });
  console.log('Bundled preload (ESM) generated');

  // Bundle the preload CJS for sandbox=on and sandbox=off CJS testing
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'preload.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: path.join(__dirname, 'dist', 'preload-bundled.cjs'),
    external: ['electron', 'electron/renderer'],
    format: 'cjs',
  });
  console.log('Bundled preload (CJS) generated');

  // Bundle the React renderer app
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'renderer.tsx')],
    bundle: true,
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(__dirname, 'dist', 'renderer.js'),
    format: 'iife',
    jsx: 'automatic',
  });
  console.log('React renderer app bundled');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
