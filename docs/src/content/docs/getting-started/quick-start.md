---
title: Quick Start
description: Build your first type-safe Electron IPC in 5 minutes.
order: 3
---

This guide will walk you through creating a simple app settings API with EIPC.

## 1. Create Your Schema

Create `src/schema/api.eipc`:

```eipc
module MyApp

enum Theme {
  Light
  Dark
  System
}

structure AppInfo {
  version: string
  platform: string
  locale: string
}

[RendererAPI]
[ContextBridge]
interface Settings {
  getTheme() -> Theme
  setTheme(theme: Theme)
  getAppInfo() -> AppInfo
}
```

## 2. Generate the Wiring

Add a generation script to your `package.json`:

```json
{
  "scripts": {
    "generate:ipc": "generate-ipc src/schema src/ipc"
  }
}
```

Then run it:

```bash
npm run generate:ipc
```

This creates the `src/ipc/` directory with all generated code. Add it to your `.gitignore`:

```
src/ipc/
```

## 3. Implement in Main Process

In your main process (`src/main/index.ts`):

```typescript
import { app, BrowserWindow, nativeTheme } from 'electron';
import { Settings } from '../ipc/browser/MyApp';
import * as path from 'path';

app.whenReady().then(() => {
  const win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Set up the implementation for this window
  Settings.for(win.webContents).setImplementation({
    async getTheme() {
      return nativeTheme.themeSource;
    },

    async setTheme(theme) {
      nativeTheme.themeSource = theme;
    },

    async getAppInfo() {
      return {
        version: app.getVersion(),
        platform: process.platform,
        locale: app.getLocale(),
      };
    },
  });

  win.loadFile('index.html');
});
```

## 4. Set Up Preload Script

In your preload script (`src/preload/index.ts`):

```typescript
import '../ipc/preload/MyApp';
```

Then bundle it with esbuild:

```javascript
// build-preload.js
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/preload/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/preload.cjs',
  format: 'cjs',
  external: ['electron'],
});
```

## 5. Use in Renderer

In your renderer process:

```typescript
import { Settings } from '../ipc/renderer/MyApp';

// Fully typed!
const theme = await Settings.getTheme();
console.log(`Current theme: ${theme}`);

await Settings.setTheme('Dark');

const info = await Settings.getAppInfo();
console.log(`Running ${info.version} on ${info.platform}`);
```

## What You Get

From this simple schema, EIPC generates:

- **TypeScript types** for `Theme` enum and `AppInfo` structure
- **Type-safe handlers** in main process
- **Context bridge exposure** in preload
- **Type-safe client** in renderer
- **Runtime validation** for all arguments

## Next Steps

- Learn about [Validators](/ipc/docs/schema-language/validators) for security
- Explore [Stores](/ipc/docs/interfaces/stores) for reactive state
- Add [Events](/ipc/docs/interfaces/events) for main-to-renderer communication
