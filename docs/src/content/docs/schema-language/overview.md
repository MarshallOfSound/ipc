---
title: Schema Language Overview
description: Learn the EIPC schema language syntax and concepts.
order: 1
---

EIPC uses a custom domain-specific language (DSL) for defining your IPC schema. Files use the `.eipc` extension.

## Basic Structure

Every schema file starts with a module declaration:

```eipc
module MyApp
```

After the module declaration, you can define:

- **Validators** — Security rules for API access
- **Enums** — Enumerated types
- **Structures** — Complex data types
- **Subtypes** — Validated primitives
- **Zod References** — External Zod schemas
- **Interfaces** — API definitions with methods

## Example Schema

```eipc
module MyApp

// Validator for production-only APIs
validator ProductionOnly = AND(
  is_packaged is true
)

// Enum type
enum Platform {
  Windows = "win32"
  Mac = "darwin"
  Linux = "linux"
}

// Structure type
structure SystemInfo {
  platform: Platform
  version: string
  memory: number
}

// Subtype with validation
subtype PositiveNumber = number (
  minValue: 1
)

// Interface with methods
[RendererAPI]
[ContextBridge]
[Validator=ProductionOnly]
interface System {
  getInfo() -> SystemInfo
  getMemoryUsage() -> PositiveNumber
}
```

## Comments

Use `//` for single-line comments:

```eipc
// This is a comment
module MyApp

interface Example {
  // Method comment
  doSomething()
}
```

## Naming Conventions

- **Modules**: PascalCase (`MyApp`, `MyApp.SubModule`)
- **Types**: PascalCase (`UserInfo`, `FileData`)
- **Methods**: camelCase (`getUser`, `saveFile`)
- **Properties**: camelCase (`userName`, `fileSize`)
- **Validators**: PascalCase (`ProductionOnly`, `LocalhostDev`)

## Next Steps

- [Validators](/docs/schema-language/validators) — Learn about security validators
- [Types](/docs/schema-language/types) — Understand the type system
- [Interfaces](/docs/interfaces/overview) — Define your API surface
