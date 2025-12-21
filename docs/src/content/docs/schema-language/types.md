---
title: Types
description: Define enums, structures, subtypes, and Zod references for your IPC schema.
order: 3
---

EIPC provides a rich type system for defining the data that flows through your IPC layer. All types are validated at runtime.

## Primitive Types

The built-in primitive types:

| Type | Description |
|------|-------------|
| `string` | String value |
| `number` | Number value |
| `boolean` | Boolean value |
| `Type?` | Optional/nullable version of any type |

## Enums

Enums define a fixed set of allowed values:

```eipc
enum Theme {
  Light
  Dark
  System
}
```

By default, enum values use the name as the value. You can specify custom values:

```eipc
enum Platform {
  MacOS = "darwin"
  Windows = "win32"
  Linux = "linux"
}
```

### Using Enums

```eipc
[RendererAPI]
[ContextBridge]
interface Settings {
  getTheme() -> Theme
  setTheme(theme: Theme)
  getPlatform() -> Platform
}
```

Generated TypeScript:

```typescript
type Theme = 'Light' | 'Dark' | 'System';
type Platform = 'darwin' | 'win32' | 'linux';
```

## Structures

Structures define complex object types:

```eipc
structure UserInfo {
  id: number
  name: string
  email?: string
}
```

### Optional Fields

Use `?` to mark fields as optional:

```eipc
structure AppConfig {
  theme: Theme
  language?: string
  notifications?: boolean
}
```

### Nested Structures

You can nest structures inline:

```eipc
structure SystemInfo {
  platform: Platform
  version: string
  memory: {
    total: number
    free: number
    used: number
  }
  cpu: {
    model: string
    cores: number
    speed: number
  }
}
```

Or reference other structures:

```eipc
structure MemoryInfo {
  total: number
  free: number
  used: number
}

structure SystemInfo {
  platform: Platform
  version: string
  memory: MemoryInfo
}
```

## Subtypes

Subtypes add validation constraints to primitive types. These are validated at runtime.

### String Subtypes

```eipc
// Length constraints
subtype Username = string(
  minLength: 3
  maxLength: 20
)

// Pattern matching
subtype HttpsUrl = string(
  startsWith: "https://"
)

// Combined constraints
subtype Slug = string(
  minLength: 1
  maxLength: 50
)
```

Available string constraints:

| Constraint | Description |
|------------|-------------|
| `minLength: N` | Minimum string length |
| `maxLength: N` | Maximum string length |
| `startsWith: "prefix"` | Must start with prefix |

### Number Subtypes

```eipc
// Range constraints
subtype Percentage = number(
  minValue: 0
  maxValue: 100
)

// Minimum only
subtype PositiveNumber = number(
  minValue: 1
)

// Maximum only
subtype Volume = number(
  maxValue: 100
)
```

Available number constraints:

| Constraint | Description |
|------------|-------------|
| `minValue: N` | Minimum value (inclusive) |
| `maxValue: N` | Maximum value (inclusive) |

### Using Subtypes

```eipc
subtype NotificationTitle = string(
  minLength: 1
  maxLength: 100
)

subtype Volume = number(
  minValue: 0
  maxValue: 100
)

[RendererAPI]
[ContextBridge]
interface Audio {
  setVolume(level: Volume)
  showNotification(title: NotificationTitle, body: string)
}
```

If a renderer passes invalid data, the call is rejected before reaching your implementation:

```typescript
import { Audio } from '../ipc/renderer/MyApp';

// Throws validation error - volume out of range
await Audio.setVolume(150);

// Throws validation error - title too long
await Audio.showNotification('x'.repeat(200), 'body');
```

## Zod References

For complex validation beyond what subtypes offer, you can reference external [Zod](https://zod.dev) schemas:

```eipc
zod_reference Email {
  import = "./schemas"
  type = "Email"
  schema = "emailSchema"
}
```

Create the corresponding TypeScript file:

```typescript
// schemas.ts
import { z } from 'zod';

export const emailSchema = z.string().email();
export type Email = z.infer<typeof emailSchema>;
```

The generated code will:
- Import and re-export the TypeScript type
- Use `schema.safeParse()` for runtime validation

### Zod Reference Options

| Option | Description |
|--------|-------------|
| `import` | Path to the TypeScript file (relative to generated `ipc/_internal/` directory) |
| `type` | Name of the exported TypeScript type |
| `schema` | Name of the exported Zod schema |

### Complex Validation Example

```typescript
// schemas.ts
import { z } from 'zod';

export const emailSchema = z.string().email();
export type Email = z.infer<typeof emailSchema>;

export const urlSchema = z.string().url().startsWith('https://');
export type SecureUrl = z.infer<typeof urlSchema>;

export const uuidSchema = z.string().uuid();
export type UUID = z.infer<typeof uuidSchema>;
```

```eipc
zod_reference Email {
  import = "../../src/schemas"
  type = "Email"
  schema = "emailSchema"
}

zod_reference SecureUrl {
  import = "../../src/schemas"
  type = "SecureUrl"
  schema = "urlSchema"
}

zod_reference UUID {
  import = "../../src/schemas"
  type = "UUID"
  schema = "uuidSchema"
}

[RendererAPI]
[ContextBridge]
interface Users {
  createUser(email: Email) -> UUID
  setAvatar(userId: UUID, url: SecureUrl)
}
```

## Type Composition

Combine types to build complex APIs:

```eipc
module MyApp

enum Status {
  Active
  Inactive
  Pending
}

subtype PositiveInt = number(
  minValue: 1
)

structure User {
  id: PositiveInt
  name: string
  email?: string
  status: Status
  metadata: {
    createdAt: number
    updatedAt: number
  }
}

[RendererAPI]
[ContextBridge]
interface Users {
  getUser(id: PositiveInt) -> User?
  listUsers() -> User[]
  updateStatus(id: PositiveInt, status: Status)
}
```

## Next Steps

- [Interfaces](/docs/interfaces/overview) — Define your API surface
- [Validators](/docs/schema-language/validators) — Add security to your APIs
