---
title: Introduction
description: Learn what EIPC is and why you should use it for your Electron apps.
order: 1
---

EIPC (Electron IPC) is a schema-first approach to building type-safe, validated, and secure inter-process communication for Electron applications.

## The Problem

Electron's IPC system is powerful but comes with challenges:

- **No type safety** — `ipcRenderer.invoke()` and `ipcMain.handle()` use strings and `any` types
- **Manual validation** — You must write validation logic for every handler
- **Boilerplate** — Registering handlers, exposing via contextBridge, and wiring everything is tedious
- **Security concerns** — It's easy to accidentally expose sensitive APIs to untrusted content

## The Solution

EIPC solves these problems with a declarative schema:

```eipc
module MyApp

[RendererAPI]
[ContextBridge]
interface Settings {
  getTheme() -> Theme
  setTheme(theme: Theme)
}
```

From this schema, EIPC generates:

- **Type-safe TypeScript interfaces** for main, preload, and renderer
- **Runtime validators** for all arguments and return values
- **Context bridge exposure** with proper security
- **React hooks** for reactive state management

## Key Features

### Type Safety

Your entire IPC layer is fully typed. TypeScript will catch errors at compile time:

```typescript
import { Settings } from './ipc/renderer/MyApp';

// ✅ TypeScript knows the types
const theme = await Settings.getTheme();

// ❌ TypeScript error: Argument of type 'number' is not assignable
await Settings.setTheme(123);
```

### Runtime Validation

Every IPC call is validated at runtime. Invalid data is rejected before reaching your handlers:

```eipc
subtype NotificationTitle = string (
  minLength: 1
  maxLength: 100
)

[RendererAPI]
[ContextBridge]
interface Notifications {
  show(title: NotificationTitle, body: string)
}
```

### Security

Validators can restrict APIs based on origin, environment, or custom conditions:

```eipc
validator ProductionOnly = AND(
  is_packaged is true
  origin is "app://myapp"
)

interface SensitiveAPI {
  [RendererAPI]
  [Validator=ProductionOnly]

  deleteAllData()
}
```

### React Hooks

Stores automatically generate React hooks for reactive state:

```eipc
interface AppState {
  [RendererAPI]
  [Store]
  windowState() -> WindowState
}
```

```tsx
function MyComponent() {
  const windowState = useWindowState();

  if (windowState.state === 'loading') return <Spinner />;
  return <div>{windowState.result.title}</div>;
}
```

## Next Steps

- [Installation](/ipc/docs/getting-started/installation) — Add EIPC to your project
- [Quick Start](/ipc/docs/getting-started/quick-start) — Build your first type-safe IPC
