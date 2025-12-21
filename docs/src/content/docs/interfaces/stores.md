---
title: Stores
description: Reactive state management with automatic React hooks.
order: 4
---

Stores provide reactive state that synchronizes between main and renderer processes. EIPC automatically generates React hooks for easy integration.

## Defining Stores

Use the `[Store]` attribute on a method to create a store:

```eipc
structure User {
  id: number
  name: string
  email: string
}

[RendererAPI]
[ContextBridge]
interface Auth {
  // Regular method
  login(email: string, password: string) -> boolean

  // Store - reactive state with React hook
  [Store]
  currentUser() -> User
}
```

A store method defines:
- The state type (return type)
- The store name (method name)

## Main Process

### Initial State

Provide the initial state in your implementation:

```typescript
import { Auth } from '../ipc/browser/MyApp';

const dispatcher = Auth.for(webContents).setImplementation({
  async login(email, password) {
    // ... authentication logic
    return true;
  },

  // Provide initial store state
  getInitialCurrentUserState() {
    return {
      id: 0,
      name: 'Guest',
      email: '',
    };
  },
});
```

The initial state method is named `getInitial` + store name (PascalCase) + `State`:

| Store Method | Initial State Method |
|--------------|---------------------|
| `currentUser()` | `getInitialCurrentUserState()` |
| `windowState()` | `getInitialWindowStateState()` |
| `settings()` | `getInitialSettingsState()` |

### Updating State

Use the dispatcher to update store state:

```typescript
// Update the store
dispatcher.updateCurrentUserStore({
  id: 123,
  name: 'John Doe',
  email: 'john@example.com',
});

// Update again later
dispatcher.updateCurrentUserStore({
  id: 123,
  name: 'John Doe (Updated)',
  email: 'john.doe@example.com',
});
```

The update method is named `update` + store name (PascalCase) + `Store`.

## Renderer Usage

### With React Hooks

Import the generated hook:

```tsx
import { useCurrentUserStore } from '../ipc/renderer-hooks/MyApp';

function UserProfile() {
  const state = useCurrentUserStore();

  if (state.state === 'loading') {
    return <div>Loading...</div>;
  }

  if (state.state === 'error') {
    return <div>Error: {state.error.message}</div>;
  }

  const user = state.result;
  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}
```

### Store State Types

The hook returns one of three states:

```typescript
type StoreState<T> =
  | { state: 'loading' }
  | { state: 'ready'; result: T }
  | { state: 'error'; error: Error };
```

Always handle all three states in your components.

### Without React

You can also use stores without React:

```typescript
import { Auth } from '../ipc/renderer/MyApp';

// Get current state (async)
const user = await Auth.currentUser.getState();

// Get current state (sync)
const user = Auth.currentUser.getStateSync();

// Subscribe to changes
const unsubscribe = Auth.currentUser.onStateChange((user) => {
  console.log('User changed:', user);
});

// Later, unsubscribe
unsubscribe();
```

## Complete Example

### Schema

```eipc
module MyApp

enum Theme {
  Light
  Dark
  System
}

structure AppSettings {
  theme: Theme
  notifications: boolean
}

[RendererAPI]
[ContextBridge]
interface App {
  setTheme(theme: Theme)

  [Store]
  settings() -> AppSettings
}
```

### Main Process

```typescript
import { App } from '../ipc/browser/MyApp';

let currentSettings: AppSettings = {
  theme: 'System',
  notifications: true,
};

const dispatcher = App.for(win.webContents).setImplementation({
  async setTheme(theme) {
    currentSettings = { ...currentSettings, theme };
    dispatcher.updateSettingsStore(currentSettings);
  },

  getInitialSettingsState() {
    return currentSettings;
  },
});
```

### React Component

```tsx
import { useSettingsStore } from '../ipc/renderer-hooks/MyApp';
import { App } from '../ipc/renderer/MyApp';

function SettingsPanel() {
  const state = useSettingsStore();

  if (state.state !== 'ready') {
    return <Spinner />;
  }

  return (
    <select
      value={state.result.theme}
      onChange={(e) => App.setTheme(e.target.value as Theme)}
    >
      <option value="Light">Light</option>
      <option value="Dark">Dark</option>
      <option value="System">System</option>
    </select>
  );
}
```

## Multiple Stores

You can have multiple stores in an interface:

```eipc
[RendererAPI]
[ContextBridge]
interface App {
  [Store]
  user() -> User

  [Store]
  settings() -> Settings

  [Store]
  notifications() -> Notification[]
}
```

Each generates its own hook:

```tsx
import {
  useUserStore,
  useSettingsStore,
  useNotificationsStore,
} from '../ipc/renderer-hooks/MyApp';
```

## Stores vs Events

| Feature | Stores | Events |
|---------|--------|--------|
| React hooks | Yes | No |
| Current state | Always available | Only changes |
| Initial state | Required | N/A |
| Use case | Stateful data | Notifications |

Use **Stores** for:
- User authentication state
- App settings/preferences
- Window state
- Any data the UI needs to display

Use **Events** for:
- Notifications
- Progress updates
- One-time occurrences

## Next Steps

- [Events](/ipc/docs/interfaces/events) — One-way notifications
- [Validators](/ipc/docs/schema-language/validators) — Secure your stores
