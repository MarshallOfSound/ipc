---
title: API Reference
description: Programmatic API for EIPC code generation.
order: 1
---

## generateWiring

The main function to generate IPC wiring from your schema files.

```typescript
import { generateWiring } from '@marshallofsound/ipc';

await generateWiring(options);
```

### Options

```typescript
interface WiringOptions {
  /**
   * Directory containing .eipc schema files
   */
  schemaDir: string;

  /**
   * Output directory for generated code
   */
  outputDir: string;

  /**
   * Optional: Custom module resolution
   */
  moduleResolver?: (moduleName: string) => string;
}
```

### Example

```typescript
import { generateWiring } from '@marshallofsound/ipc';

await generateWiring({
  schemaDir: './src/schema',
  outputDir: './ipc',
});
```

### Generated Output

The function creates the following directory structure:

```
ipc/
├── browser/           # Main process code
│   └── {Module}/
│       └── {Interface}.ts
├── preload/           # Preload script code
│   ├── init.ts        # Initialization entry point
│   └── {Module}/
│       └── {Interface}.ts
├── renderer/          # Renderer process types
│   └── {Module}/
│       └── {Interface}.ts
├── renderer-hooks/    # React hooks (for [Store] methods)
│   └── {Module}/
│       └── {Interface}.ts
├── common/            # Shared types
│   └── {Module}/
│       └── {Type}.ts
└── _internal/         # Internal utilities
  └── common-runtime/
```

## Error Handling

The function throws on schema parsing errors:

```typescript
try {
  await generateWiring(options);
} catch (error) {
  console.error('Schema error:', error.message);
  // Error includes line/column information
}
```
