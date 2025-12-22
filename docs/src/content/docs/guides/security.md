---
title: Security Best Practices
description: How to design secure IPC APIs with EIPC validators and data validation.
order: 1
---

Electron's architecture splits your app into a trusted main process (with full Node.js access) and untrusted renderer processes (which may run arbitrary web content). IPC is the bridge between them - and a critical attack surface.

## The Threat Model

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer Process (untrusted)                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Your app code, but also:                           │   │
│  │  - XSS payloads if your app has vulnerabilities     │   │
│  │  - Malicious content if loading external pages      │   │
│  │  - Compromised dependencies                         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────────┘
                      │ IPC calls
┌─────────────────────▼───────────────────────────────────────┐
│  Main Process (trusted)                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Full access to:                                    │   │
│  │  - File system                                      │   │
│  │  - Shell commands                                   │   │
│  │  - Native APIs                                      │   │
│  │  - Network without CORS                             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Assume any renderer could be compromised.** Your IPC layer must validate every request.

## Validators: Your First Line of Defense

Every interface should have a validator. EIPC checks validators both when exposing APIs via contextBridge and on every call.

### Basic Validator

```eipc
validator MyApp = AND(
  origin is "https://myapp.com"
  is_main_frame is true
)

[RendererAPI]
[Validator=MyApp]
[ContextBridge]
interface Settings {
  getTheme() -> string
}
```

### Custom Protocols

For apps using custom protocols:

```eipc
validator LocalApp = AND(
  origin is "app://myapp"
  is_main_frame is true
)
```

### Multiple Trusted Origins

```eipc
validator TrustedOrigins = AND(
  is_main_frame is true
  OR(
    origin is "https://myapp.com"
    origin is "https://app.myapp.com"
  )
)
```

### Prefix Matching

Use `startsWith` when you need to match URL patterns:

```eipc
validator AdminPages = AND(
  is_main_frame is true
  href startsWith "https://myapp.com/admin"
)
```

### Environment-Based Validators

Production has predictable origins, but development is messy (localhost, file://, various ports). Use environment validators to handle both:

```eipc
validator MyApp = {
  production: AND(
    origin is "https://myapp.com"
    is_main_frame is true
  )
  development: AND(
    is_main_frame is true
    // Relaxed - any origin in dev
  )
}
```

Environment is resolved at build time via `EIPC_ENV` or `NODE_ENV`.

## Frame Security

**Default to main frame only.** Iframes can be injected by attackers or contain untrusted content.

```eipc
// Standard pattern - blocks iframes
validator Standard = AND(
  origin is "https://myapp.com"
  is_main_frame is true
)
```

### When to Allow Iframes

Rare, but valid cases exist:

| Use Case | Approach |
|----------|----------|
| Trusted first-party iframe | Same origin validation, no `is_main_frame` |
| Third-party widget | Separate limited interface, strict origin |

```eipc
// Full API - main frame only
[RendererAPI]
[Validator=MainFrameOnly]
[ContextBridge]
interface FullAPI {
  readUserData() -> UserData
  writeUserData(data: UserData)
}

// Limited API - specific iframe allowed
validator WidgetOrigin = AND(
  origin is "https://trusted-widget.example.com"
)

[RendererAPI]
[Validator=WidgetOrigin]
[ContextBridge]
interface WidgetAPI {
  getTheme() -> Theme
  // Intentionally limited surface
}
```

When allowing iframes:
- Use a separate, minimal interface
- Be extra strict on origin
- Document why frame access is needed

## Data Validation

EIPC validates all data crossing the IPC boundary:

### What EIPC Validates

| Feature | Example | Validated |
|---------|---------|-----------|
| Argument types | `foo: string` | String, not number |
| Return types | `-> User` | Matches structure |
| Optional fields | `name?: string` | Undefined or string |
| Arrays | `items: string[]` | Array of strings |
| Enums | `status: Status` | Valid enum value |
| Subtypes | `minLength: 3` | Meets constraints |
| Zod references | `email: Email` | Passes Zod schema |

### What You Must Still Validate

EIPC validates shape and types, but **your implementation must validate semantics**:

```typescript
import { realpath } from 'node:fs/promises';
import * as path from 'node:path';

Files.setImplementation({
  async readFile(userPath) {
    // EIPC validated: userPath is a string
    // YOU must validate: path doesn't escape allowed directory

    const allowedDir = '/app/user-data';
    const resolved = path.resolve(allowedDir, userPath);
    const real = await realpath(resolved);
    const rel = path.relative(allowedDir, real);

    // Check path doesn't escape via ../ or symlinks
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Access denied');
    }

    return fs.readFile(real, 'utf8');
  },
});

Database.setImplementation({
  async getUser(userId) {
    // EIPC validated: userId is a number
    // Always use parameterized queries - never interpolate user input

    return db.query('SELECT * FROM users WHERE id = ?', [userId]);
  },
});
```

### Use Subtypes and Zod for Constraints

Push validation into the schema where possible:

```eipc
subtype PositiveInt = number(
  minValue: 1
)

subtype Username = string(
  minLength: 3
  maxLength: 20
)

[RendererAPI]
[Validator=MyApp]
[ContextBridge]
interface Users {
  getUser(id: PositiveInt) -> User
  rename(id: PositiveInt, name: Username)
}
```

For complex validation (regex patterns, email formats, UUIDs), use Zod references:

```eipc
zod_reference Email {
  import = "../../src/schemas"
  type = "Email"
  schema = "emailSchema"
}

zod_reference UUID {
  import = "../../src/schemas"
  type = "UUID"
  schema = "uuidSchema"
}

[RendererAPI]
[Validator=MyApp]
[ContextBridge]
interface Users {
  getByEmail(email: Email) -> User?
  getById(id: UUID) -> User?
}
```

```typescript
// src/schemas.ts
import { z } from 'zod';

export const emailSchema = z.string().email();
export type Email = z.infer<typeof emailSchema>;

export const uuidSchema = z.string().uuid();
export type UUID = z.infer<typeof uuidSchema>;
```

Invalid data is rejected before reaching your implementation.

## Security Checklist

Before shipping:

- [ ] Every interface has a `[Validator=...]` tag
- [ ] Production validators specify exact origins
- [ ] Validators include `is_main_frame is true` (unless intentionally allowing frames)
- [ ] File paths are validated against directory escapes (use `realpath` + `relative`)
- [ ] Database queries use parameterized statements
- [ ] Shell commands never interpolate user input
- [ ] Error messages don't leak sensitive information
- [ ] Sensitive APIs use environment validators with strict production rules

## What EIPC Doesn't Protect Against

EIPC secures the IPC boundary, but can't protect against:

| Threat | Why | Mitigation |
|--------|-----|------------|
| Implementation bugs | Your code runs after validation | Code review, testing |
| Path traversal | Semantic, not type issue | Use `realpath` + `relative` checks |
| SQL injection | Your code constructs queries | Always use parameterized queries |
| Command injection | Your code runs shell commands | Avoid shell; use direct APIs |
| Timing attacks | No rate limiting | Implement rate limiting if needed |
| Large payloads | No size limits | Add size checks if needed |
| Main process compromise | Game over if main is compromised | Keep main process minimal |

## Summary

1. **Every interface needs a validator** - No exceptions
2. **Use environment validators** - Strict production, flexible development
3. **Default to main frame** - Allow iframes only with good reason
4. **Schema validates types** - Your code validates semantics
5. **Trust nothing from renderers** - Even with validators, validate business logic
