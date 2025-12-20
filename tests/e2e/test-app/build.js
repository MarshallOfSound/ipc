const path = require('path');
const { generateWiring } = require('../../../dist/cjs/index.js');
const esbuild = require('esbuild');

async function build() {
  // Generate the IPC wiring
  await generateWiring({
    schemaFolder: __dirname,
    wiringFolder: path.join(__dirname, 'ipc'),
  });
  console.log('E2E test app IPC wiring generated');

  // Bundle the preload for sandbox mode testing
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'preload.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: path.join(__dirname, 'dist', 'preload-bundled.js'),
    external: ['electron'],
    format: 'cjs',
  });
  console.log('Bundled preload generated for sandbox mode');

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
