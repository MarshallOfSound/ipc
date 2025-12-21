---
title: Installation
description: Add EIPC to your Electron project.
order: 2
---

## Prerequisites

- Node.js 18 or later
- An Electron project (v18.0.3 or later)
- TypeScript (recommended)

## Install the Package

```bash
npm install @marshallofsound/ipc
```

Or with yarn:

```bash
yarn add @marshallofsound/ipc
```

## Project Structure

EIPC works best with a structured project layout:

```
my-electron-app/
├── src/
│   ├── main/           # Main process code
│   ├── preload/        # Preload scripts
│   ├── renderer/       # Renderer process code
│   └── schema/         # Your .eipc schema files
│       └── api.eipc
├── ipc/                # Generated code (auto-created)
│   ├── browser/
│   ├── preload/
│   ├── renderer/
│   └── ...
└── package.json
```

## TypeScript Configuration

Ensure your `tsconfig.json` includes the generated IPC directory:

```json
{
  "compilerOptions": {
  "module": "ESNext",
  "moduleResolution": "bundler",
  "esModuleInterop": true,
  "strict": true
  },
  "include": ["src/**/*", "ipc/**/*"]
}
```

## Build Integration

Add a script to generate your IPC wiring:

```json
{
  "scripts": {
  "generate:ipc": "node scripts/generate-ipc.js",
  "build": "npm run generate:ipc && your-build-command"
  }
}
```

Create `scripts/generate-ipc.js`:

```javascript
import { generateWiring } from '@marshallofsound/ipc';

await generateWiring({
  schemaDir: './src/schema',
  outputDir: './ipc',
});
```

## Electron Forge Integration

If using Electron Forge, add generation to your `forge.config.js`:

```javascript
module.exports = {
  hooks: {
  generateAssets: async () => {
    const { generateWiring } = await import('@marshallofsound/ipc');
    await generateWiring({
    schemaDir: './src/schema',
    outputDir: './ipc',
    });
  },
  },
};
```

## Next Steps

Now that EIPC is installed, continue to the [Quick Start](/ipc/docs/getting-started/quick-start) guide to create your first schema.
