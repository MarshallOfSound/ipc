---
title: Methods
description: Async and sync methods for IPC communication.
order: 2
---

EIPC supports both asynchronous and synchronous methods for different use cases.

## Async Methods (Default)

By default, all methods are asynchronous. They use Electron's `ipcRenderer.invoke` / `ipcMain.handle` under the hood:

```eipc
[RendererAPI]
[ContextBridge]
interface DataService {
  fetchData(id: number) -> Data
  saveData(data: Data) -> boolean
}
```

### Usage

```typescript
import { DataService } from '../ipc/renderer/MyApp';

// Renderer - returns a Promise
const data = await DataService.fetchData(123);
const success = await DataService.saveData(data);
```

### Implementation

```typescript
// Main process
DataService.for(webContents).setImplementation({
  async fetchData(id) {
    const result = await database.query(id);
    return result;
  },

  async saveData(data) {
    await database.save(data);
    return true;
  },
});
```

## Sync Methods

For cases where you need synchronous execution (blocks the renderer), use the `[Sync]` attribute:

```eipc
[RendererAPI]
[ContextBridge]
interface Config {
  // Async (default)
  loadConfig() -> Config

  // Sync - blocks renderer until complete
  [Sync]
  getConfigSync() -> Config

  [Sync]
  getValueSync(key: string) -> string
}
```

### Usage

```typescript
import { Config } from '../ipc/renderer/MyApp';

// Renderer - returns value directly (not a Promise)
const config = Config.getConfigSync();
const value = Config.getValueSync('theme');
```

### Implementation

```typescript
// Main process - still uses async in implementation
Config.for(webContents).setImplementation({
  async loadConfig() {
    return await fs.promises.readFile('config.json', 'utf-8');
  },

  // Sync methods still use async implementation
  async getConfigSync() {
    return JSON.parse(fs.readFileSync('config.json', 'utf-8'));
  },

  async getValueSync(key) {
    const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
    return config[key];
  },
});
```

### When to Use Sync

Use sync methods sparingly. They block the renderer process until complete, which can cause UI freezes. Good use cases:

- **Initialization** — Getting initial state before app renders
- **Critical path** — Operations that must complete before continuing
- **Simple reads** — Fast synchronous reads from memory

Avoid sync methods for:

- Network requests
- Large file operations
- Database queries
- Any operation that might be slow

## NotImplemented Methods

The `[NotImplemented]` attribute marks methods that are defined in the schema but not yet implemented. Calling them throws an error:

```eipc
[RendererAPI]
[ContextBridge]
interface Features {
  existingFeature() -> string

  [NotImplemented]
  futureFeature() -> string

  [NotImplemented]
  anotherPlannedFeature(data: Data) -> Result
}
```

This is useful for:

- **API planning** — Define future APIs without implementing them
- **Deprecation** — Mark old methods that are no longer supported
- **Type generation** — Generate types for methods not yet available

```typescript
import { Features } from '../ipc/renderer/MyApp';

await Features.existingFeature(); // Works

await Features.futureFeature();
// Throws: "futureFeature is not implemented"
```

## Return Types

### Required Return

```eipc
interface API {
  getData() -> Data
}
```

The method must return a value of the specified type.

### Optional Return

```eipc
interface API {
  findData(id: number) -> Data?
}
```

The method can return `null` or `undefined`.

### No Return

```eipc
interface API {
  logMessage(message: string)
}
```

The method returns nothing (void). In async methods, returns `Promise<void>`.

## Method Arguments

### Single Argument

```eipc
interface API {
  getUser(id: number) -> User
}
```

### Multiple Arguments

```eipc
interface API {
  createUser(name: string, email: string, age: number) -> User
}
```

### Complex Arguments

Use structures for complex argument types:

```eipc
structure CreateUserRequest {
  name: string
  email: string
  age?: number
  roles: string[]
}

interface API {
  createUser(request: CreateUserRequest) -> User
}
```

### Validated Arguments

Use subtypes for automatic validation:

```eipc
subtype Email = string(
  minLength: 5
  maxLength: 100
)

subtype Age = number(
  minValue: 0
  maxValue: 150
)

interface API {
  createUser(name: string, email: Email, age: Age) -> User
}
```

Invalid arguments are rejected before reaching your implementation:

```typescript
import { API } from '../ipc/renderer/MyApp';

// Throws validation error
await API.createUser('John', 'invalid-email', -5);
```

## Next Steps

- [Events](/ipc/docs/interfaces/events) — Send events from main to renderer
- [Stores](/ipc/docs/interfaces/stores) — Reactive state with React hooks
