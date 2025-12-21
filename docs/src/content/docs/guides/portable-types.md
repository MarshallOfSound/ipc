---
title: Portable Types
description: Share IPC type definitions with external projects using dts-bundle-generator.
order: 1
---

When building an Electron app that loads external web content (like a webapp from a different repository), you may want to provide type-safe IPC access to that external code. This guide shows how to generate portable type definitions that can be copied to other projects.

## The Problem

Your Electron app has IPC interfaces defined in EIPC:

```eipc
module myapp.web

structure UserPreferences {
  theme: string
  fontSize: number
}

[RendererAPI]
[ContextBridge]
interface Settings {
  getPreferences() -> UserPreferences
  setPreferences(prefs: UserPreferences)
}
```

A webapp loaded in your Electron app (via `<webview>` or `loadURL`) needs to call these APIs with full type safety — but it lives in a different repository and can't import from your Electron app's source.

## The Solution

Use [dts-bundle-generator](https://github.com/timocov/dts-bundle-generator) to bundle your IPC type definitions into standalone `.d.ts` files that can be copied to other projects.

## Setup

Install dts-bundle-generator:

```bash
npm install -D dts-bundle-generator
```

## Build Script

Create a build script that generates both the normal IPC wiring and portable type bundles:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'child_process';
import { generateWiring } from '@marshallofsound/ipc';

// Modules to expose to external apps
const PORTABLE_MODULES = ['myapp.web'];

export async function generateIPCWiring(buildPortable: boolean) {
  const schemaDir = path.resolve(__dirname, '../src/schema');
  const outputDir = path.resolve(__dirname, '../src/ipc');

  // Generate normal wiring
  await generateWiring({
    schemaFolder: schemaDir,
    wiringFolder: outputDir,
  });

  if (!buildPortable) return;

  // Clean portable output directory
  const portableDir = path.resolve(__dirname, '../portable-api');
  await fs.promises.rm(portableDir, { recursive: true, force: true });
  await fs.promises.mkdir(`${portableDir}/common`, { recursive: true });
  await fs.promises.mkdir(`${portableDir}/renderer`, { recursive: true });

  const banner = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT
 *
 * Copy this file from the electron-app repo.
 * Run \`npm run build:portable\` to regenerate.
 */`;

  for (const moduleId of PORTABLE_MODULES) {
    // Bundle type definitions into single .d.ts file
    await spawnAsync('npx', [
      'dts-bundle-generator',
      `src/ipc/common/${moduleId}.ts`,
      '-o', `portable-api/common/${moduleId}.d.ts`,
      '--no-banner',
      '--no-check',
      '--project', 'tsconfig.json',
    ]);

    // Add banner to generated types
    const typesPath = `${portableDir}/common/${moduleId}.d.ts`;
    const types = await fs.promises.readFile(typesPath, 'utf-8');
    await fs.promises.writeFile(typesPath, `${banner}\n/* eslint-disable */\n${types}`);

    // Copy renderer runtime
    const rendererPath = `src/ipc/renderer/${moduleId}.ts`;
    const renderer = await fs.promises.readFile(rendererPath, 'utf-8');
    await fs.promises.writeFile(
      `${portableDir}/renderer/${moduleId}.ts`,
      `${banner}\n${renderer}`
    );
  }
}

function spawnAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit' });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Exit ${code}`)));
  });
}
```

## Package Scripts

Add scripts to your `package.json`:

```json
{
  "scripts": {
    "build:ipc": "tsx build/ipc-wiring.ts",
    "build:portable": "tsx build/ipc-wiring.ts --portable"
  }
}
```

## Output Structure

After running `npm run build:portable`, you'll have:

```
portable-api/
├── common/
│   └── myapp.web.d.ts    # Bundled type definitions
└── renderer/
    └── myapp.web.ts      # Runtime code for calling IPC
```

## Using in External Project

Copy the `portable-api` directory to your external webapp project:

```
webapp/
├── src/
│   ├── electron-api/           # Copied from portable-api
│   │   ├── common/
│   │   │   └── myapp.web.d.ts
│   │   └── renderer/
│   │       └── myapp.web.ts
│   └── app.tsx
└── tsconfig.json
```

Import and use with full type safety:

```typescript
import { Settings } from './electron-api/renderer/myapp.web';

// Fully typed!
const prefs = await Settings.getPreferences();
console.log(prefs.theme); // TypeScript knows this is a string

await Settings.setPreferences({
  theme: 'dark',
  fontSize: 14,
});
```

## Handling External Dependencies

If your IPC types reference external packages, use `--external-inlines` to inline those types:

```typescript
await spawnAsync('npx', [
  'dts-bundle-generator',
  `src/ipc/common/${moduleId}.ts`,
  '-o', `portable-api/common/${moduleId}.d.ts`,
  '--no-banner',
  '--no-check',
  '--external-inlines', 'some-package',  // Inline types from this package
  '--project', 'tsconfig.json',
]);
```

## Automation

Set up a CI job to regenerate and commit portable types when schemas change:

```yaml
# .github/workflows/portable-types.yml
name: Update Portable Types

on:
  push:
    paths:
      - 'src/schema/**/*.eipc'

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build:portable
      - uses: peter-evans/create-pull-request@v5
        with:
          commit-message: 'chore: update portable IPC types'
          title: 'Update portable IPC types'
          branch: update-portable-types
```

## Best Practices

1. **Version your portable types** — Include a version comment or file so consumers know when to update

2. **Document the copy process** — Add a README in `portable-api/` explaining how consumers should use the files

3. **Only expose what's needed** — Don't make all modules portable, only those specifically designed for external consumption

4. **Consider security** — Portable modules are accessible to external code loaded in your app; use [Validators](/ipc/docs/schema-language/validators) to restrict access appropriately
