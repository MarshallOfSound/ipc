# @marshallofsound/ipc

> Type-safe, validated, and secure Electron IPC with zero boilerplate

## Why?

Electron apps typically expose APIs from the main process to renderer processes using `ipcMain.handle` and `ipcRenderer.invoke`. This works, but leads to:

- **Boilerplate explosion** - Each API requires handler registration, message channel naming, and contextBridge exposure
- **No type safety** - TypeScript can't verify that renderer calls match main process handlers
- **No validation** - Invalid messages aren't rejected, leading to runtime errors or security issues
- **No origin checking** - Any webpage loaded in your app can call any exposed API

This module solves all of these problems with a schema-first approach that generates fully typed, validated, and secure IPC code.

## Features

- **Zero boilerplate** - Define your API in a schema, get all the wiring generated
- **Type safe** - Generated TypeScript ensures renderer calls match main process implementations
- **Secure by default** - Runtime validation of arguments/return values, origin checking, frame restrictions
- **Events & Stores** - Main-to-renderer events and reactive state with React hooks
- **Automatic contextBridge** - APIs are automatically exposed to renderer

## Installation

```bash
npm install @marshallofsound/ipc
# or
yarn add @marshallofsound/ipc
```

Requires Electron >= 18.0.3

## Quick Start

### 1. Create a schema file

Create `schemas/api.eipc`:

```
module myapp

validator OnlyMyApp = AND(
    origin is "https://myapp.com"
    is_main_frame is true
)

[RendererAPI]
[Validator=OnlyMyApp]
[ContextBridge]
interface FileSystem {
    ReadConfig() -> string
    WriteConfig(content: string) -> boolean
}
```

### 2. Generate the wiring

```ts
import { generateWiring } from '@marshallofsound/ipc';
import path from 'path';

await generateWiring({
    schemaFolder: path.resolve(__dirname, 'schemas'),
    wiringFolder: path.resolve(__dirname, 'src/ipc'),
});
```

> **Tip:** When using Electron Forge, call this in the `generateAssets` hook in your `forge.config.js`.

### 3. Implement in main process

```ts
// main.ts
import { FileSystem } from './ipc/browser/myapp';
import fs from 'fs';

FileSystem.for(mainWindow.webContents.mainFrame).setImplementation({
    ReadConfig(path) {
        // Ensure you
        return fs.readFileSync(configPath, 'utf-8');
    },
    WriteConfig(content) {
        fs.writeFileSync(configPath, content);
        return true;
    },
});
```

### 4. Initialize in preload

```ts
// preload.ts
import './ipc/preload/myapp';
```

#### Bundling the Preload Script

The preload script **must be bundled** before use. This is required because:
1. Electron's preload context has specific module format requirements
2. The generated IPC files use ES modules which need bundling for preload compatibility

Use [esbuild](https://esbuild.github.io/) or another bundler:

```ts
import esbuild from 'esbuild';

// For sandbox: false - use ESM format with .mjs extension
await esbuild.build({
  entryPoints: ['preload.ts'],
  bundle: true,
  platform: 'node',
  outfile: 'dist/preload.mjs',
  external: ['electron', 'electron/renderer'],
  format: 'esm',
});

// For sandbox: true - use CJS format with .cjs extension
await esbuild.build({
  entryPoints: ['preload.ts'],
  bundle: true,
  platform: 'node',
  outfile: 'dist/preload.cjs',
  external: ['electron', 'electron/renderer'],
  format: 'cjs',
});
```

Then reference the correct preload in your BrowserWindow:

```ts
new BrowserWindow({
  webPreferences: {
    sandbox: false,
    preload: path.join(__dirname, 'preload.mjs'), // ESM for sandbox: false
    // OR
    sandbox: true,
    preload: path.join(__dirname, 'preload.cjs'), // CJS for sandbox: true
  },
});
```

> **Note:** The `.cjs` extension also works with `sandbox: false`, so you can use a single CJS bundle for both modes if preferred.

### 5. Call from renderer

```ts
// renderer.ts (or browser devtools)
const content = await window.myapp.FileSystem.ReadConfig();
```

## Schema Reference

### Module Declaration

Every schema file must start with a module declaration:

```
module company.product
```

The module name becomes the namespace on `window` (e.g., `window['company.product']`).

### Validators

Validators control when APIs are exposed and when calls are allowed. They run both at preload time (to decide whether to expose the API) and at call time (to verify each request).

```
validator MyValidator = AND(
    condition1
    condition2
    OR(
        condition3
        condition4
    )
)
```

#### Available Conditions

| Condition | Description |
|-----------|-------------|
| `is_packaged is true/false` | Check if app is packaged (production) or running from source |
| `is_main_frame is true/false` | Check if request comes from main frame (not iframe) |
| `origin is "https://example.com"` | Check the page origin (supports custom protocols like `app://`) |
| `hostname is "localhost"` | Check the hostname |
| `protocol is "https:"` | Check the protocol |
| `dynamic_global(flagName)` | Check if `global.flagName` is truthy in main process |

#### Environment-Specific Validators

Define different rules for different environments:

```
validator MyValidator = {
    production: AND(
        is_packaged is true
        origin is "https://myapp.com"
    )
    development: AND(
        is_packaged is false
        hostname is "localhost"
    )
}
```

The environment is determined by `EIPC_ENV` or `NODE_ENV` at build time. This is **not** a runtime flag.

### Subtypes

Define validated string or number types:

```
subtype Username = string(
    minLength: 3
    maxLength: 20
)

subtype HttpsUrl = string(
    startsWith: "https://"
)

subtype Percentage = number(
    minValue: 0
    maxValue: 100
)

subtype PositiveInt = number(
    minValue: 0
)
```

Arguments using these subtypes are validated at runtime before reaching your implementation.

### Zod References (Advanced)

When subtypes aren't expressive enough, you can reference external [Zod](https://zod.dev) schemas for complex validation:

```
zod_reference Email {
    import = "./schemas"
    type = "Email"
    schema = "emailSchema"
}
```

This requires a corresponding TypeScript file:

```ts
// schemas.ts
import { z } from 'zod';

export const emailSchema = z.string().email();
export type Email = z.infer<typeof emailSchema>;
```

The generated code will:
- Import and re-export the TypeScript type
- Use `schema.safeParse()` for runtime validation

> **Note:** Import paths are relative to the generated `ipc/_internal/` directory, not your schema file.

### Enums

```
enum Platform {
    MacOS = "darwin"
    Windows = "win32"
    Linux = "linux"
}
```

Values are optional - if omitted, the enum name is used as the value.

### Structures

```
structure UserInfo {
    id: number
    name: string
    email?: string           // Optional field
    metadata: {              // Nested inline structure
        createdAt: number
        updatedAt: number
    }
}
```

### Interfaces

Interfaces define the actual APIs exposed to renderers.

```
[RendererAPI]
[Validator=MyValidator]
[ContextBridge]
interface MyAPI {
    // Async method (default)
    GetData(id: number) -> string

    // Sync method
    [Sync]
    GetDataSync(id: number) -> string

    // Method with optional return
    FindUser(name: string) -> UserInfo?

    // Event (main -> renderer)
    [Event]
    OnDataChanged(newData: string)

    // Store (reactive state with React hooks)
    [Store]
    currentUser() -> UserInfo

    // Placeholder for future features
    [NotImplemented]
    FutureMethod() -> string
}
```

#### Interface Attributes

| Attribute | Description |
|-----------|-------------|
| `[RendererAPI]` | API called from renderer, implemented in main |
| `[Validator=Name]` | Apply a validator to all methods |
| `[ContextBridge]` | Auto-expose via contextBridge |

#### Method Attributes

| Attribute | Description |
|-----------|-------------|
| `[Sync]` | Synchronous IPC (blocks renderer) |
| `[Event]` | Event dispatched from main to renderer |
| `[Store]` | Reactive state with `getState()`, `getStateSync()`, `onStateChange()` |
| `[NotImplemented]` | Placeholder - throws if called, used to generate types for old methods that are no longer implemented |

### Types

| Type | Description |
|------|-------------|
| `string` | String value |
| `number` | Number value |
| `boolean` | Boolean value |
| `Type?` | Optional/nullable type |
| `CustomType` | Reference to enum, structure, or subtype |

## Generated Code Structure

```
ipc/
├── browser/           # Main process - import from here
│   └── myapp.ts
├── preload/           # Preload scripts - import to initialize
│   └── myapp.ts
├── renderer/          # Renderer process - for type-safe access
│   └── myapp.ts
├── renderer-hooks/    # React hooks for stores
│   └── myapp.ts
├── common/            # Shared types - import from anywhere
│   └── myapp.ts
└── _internal/         # Generated internals - don't import directly
```

## Main Process API

```ts
import { MyAPI } from './ipc/browser/myapp';

// Set up handlers for a specific frame
const dispatcher = MyAPI.for(mainWindow.webContents.mainFrame).setImplementation({
    GetData(id) {
        return `Data for ${id}`;
    },
    getInitialCurrentUserState() {
        return { id: 1, name: 'Guest' };
    },
});

// Dispatch events
dispatcher.dispatchOnDataChanged('new data');

// Update store state
dispatcher.updateCurrentUserStore({ id: 2, name: 'User' });

// Get existing dispatcher
const existing = MyAPI.getDispatcher(frame);
```

## React Hooks

For `[Store]` methods, React hooks are generated:

```tsx
import { useCurrentUserStore } from './ipc/renderer-hooks/myapp';

function UserDisplay() {
    const state = useCurrentUserStore();

    if (state.state === 'loading') return <div>Loading...</div>;
    if (state.state === 'error') return <div>Error: {state.error.message}</div>;

    return <div>Hello, {state.result.name}!</div>;
}
```

The hook returns:
- `{ state: 'loading' }` - Initial load in progress
- `{ state: 'ready', result: T }` - Data available
- `{ state: 'error', error: Error }` - Load failed

## Testing

```bash
# Unit tests
yarn test

# E2E tests (Electron + Playwright)
yarn test:e2e

# E2E with visible windows (for debugging)
DEBUG_E2E_TEST=1 yarn test:e2e
```
