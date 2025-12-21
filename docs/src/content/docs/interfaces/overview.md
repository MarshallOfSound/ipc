---
title: Interfaces Overview
description: Define your IPC API surface with interfaces.
order: 1
---

Interfaces define the actual APIs exposed between your main and renderer processes. They are the core building block of EIPC.

## Basic Interface

```eipc
[RendererAPI]
[ContextBridge]
interface Settings {
  getTheme() -> string
  setTheme(theme: string)
  getLocale() -> string
}
```

## Interface Attributes

Interfaces can have attributes that modify their behavior:

| Attribute | Description |
|-----------|-------------|
| `[RendererAPI]` | API is called from renderer, implemented in main |
| `[ContextBridge]` | Automatically expose via `contextBridge.exposeInMainWorld` |
| `[Validator=Name]` | Apply a security validator to all methods |

### RendererAPI

The `[RendererAPI]` attribute indicates that the interface is called from the renderer process and implemented in the main process. This is the most common pattern.

```eipc
[RendererAPI]
interface MyAPI {
  doSomething() -> string
}
```

### ContextBridge

The `[ContextBridge]` attribute automatically exposes the API via Electron's `contextBridge.exposeInMainWorld`, making it available to import in your renderer:

```eipc
module MyApp

[RendererAPI]
[ContextBridge]
interface Settings {
  getTheme() -> string
}
```

Import and use in your renderer:

```typescript
import { Settings } from './ipc/renderer/MyApp';

const theme = await Settings.getTheme();
```

### Validator

Apply a security validator to protect all methods in the interface:

```eipc
validator OnlyMyApp = AND(
  origin is "https://myapp.com"
  is_main_frame is true
)

[RendererAPI]
[Validator=OnlyMyApp]
[ContextBridge]
interface SecureAPI {
  getSensitiveData() -> string
}
```

## Methods

Methods define the operations available on an interface:

```eipc
interface MyAPI {
  // Simple method with no arguments
  ping() -> string

  // Method with arguments
  greet(name: string) -> string

  // Method with multiple arguments
  calculate(a: number, b: number) -> number

  // Method with optional return
  findUser(id: number) -> User?

  // Method with no return value
  logMessage(message: string)
}
```

### Return Types

- `-> Type` — Returns a value of the specified type
- `-> Type?` — Returns an optional value (can be null/undefined)
- No arrow — Method returns nothing (void)

## Main Process Implementation

In your main process, implement the interface:

```typescript
import { Settings } from './ipc/browser/MyApp';
import { nativeTheme, app } from 'electron';

Settings.for(mainWindow.webContents).setImplementation({
  async getTheme() {
    return nativeTheme.themeSource;
  },

  async setTheme(theme) {
    nativeTheme.themeSource = theme;
  },

  async getLocale() {
    return app.getLocale();
  },
});
```

### Frame-Specific Implementations

You can set different implementations for different frames:

```typescript
// Main frame - full access
Settings.for(mainWindow.webContents.mainFrame).setImplementation({
  async getTheme() {
    return nativeTheme.themeSource;
  },
  async setTheme(theme) {
    nativeTheme.themeSource = theme;
  },
  // ...
});

// Iframe - read-only access
Settings.for(iframeWebContents.mainFrame).setImplementation({
  async getTheme() {
    return nativeTheme.themeSource;
  },
  async setTheme(theme) {
    throw new Error('Not allowed in iframe');
  },
  // ...
});
```

## Preload Setup

Import the generated preload code to expose the API:

```typescript
// preload.ts
import './ipc/preload/MyApp';
```

This must be bundled before use. See [Installation](/ipc/docs/getting-started/installation) for bundling instructions.

## Renderer Usage

Call the API from your renderer process:

```typescript
import { Settings } from './ipc/renderer/MyApp';

// Fully typed!
const theme = await Settings.getTheme();
const locale = await Settings.getLocale();

await Settings.setTheme('dark');
```

## Multiple Interfaces

You can define multiple interfaces in a single schema file:

```eipc
module MyApp

[RendererAPI]
[ContextBridge]
interface Settings {
  getTheme() -> string
  setTheme(theme: string)
}

[RendererAPI]
[ContextBridge]
interface App {
  getVersion() -> string
  getLocale() -> string
  quit()
}
```

Each interface can be imported separately:

```typescript
import { Settings, App } from './ipc/renderer/MyApp';

await Settings.getTheme();
await App.getVersion();
```

## Next Steps

- [Methods](/ipc/docs/interfaces/methods) — Learn about sync and async methods
- [Events](/ipc/docs/interfaces/events) — Send events from main to renderer
- [Stores](/ipc/docs/interfaces/stores) — Reactive state with React hooks
