---
title: API Reference
description: CLI and programmatic API for EIPC code generation.
order: 1
---

## CLI

The `generate-ipc` command generates IPC wiring from your schema files.

```bash
generate-ipc <schemaDir> <outputDir>
```

### Arguments

| Argument | Description |
|----------|-------------|
| `schemaDir` | Directory containing `.eipc` schema files |
| `outputDir` | Output directory for generated code |

### Example

```bash
generate-ipc src/schema src/ipc
```

### Package.json Integration

```json
{
  "scripts": {
    "generate:ipc": "generate-ipc src/schema src/ipc"
  }
}
```

## Programmatic API

For advanced use cases, you can use the programmatic API directly.

```typescript
import { generateWiring } from '@marshallofsound/ipc';

await generateWiring({
  schemaFolder: './src/schema',
  wiringFolder: './src/ipc',
});
```

### Options

```typescript
interface WiringOptions {
  /**
   * Absolute path to a folder containing .eipc schema files
   */
  schemaFolder: string;

  /**
   * Absolute path to output folder for generated code
   */
  wiringFolder: string;
}
```

## Generated Output

Both the CLI and programmatic API create the following directory structure:

```
src/ipc/
├── browser/          # Main process implementations
│   └── {module}.ts
├── preload/          # Preload script code
│   └── {module}.ts
├── renderer/         # Renderer process client
│   └── {module}.ts
├── renderer-hooks/   # React hooks for stores
│   └── {module}.ts
├── common/           # Shared types
│   └── {module}.ts
├── common-runtime/   # Runtime utilities
│   └── {module}.ts
└── _internal/        # Internal generated code
    └── ...
```

## Error Handling

Both methods throw on schema parsing errors with line/column information:

```typescript
try {
  await generateWiring(options);
} catch (error) {
  console.error('Schema error:', error.message);
}
```

CLI exits with code 1 on error:

```bash
$ generate-ipc src/schema src/ipc
Error generating IPC wiring: Expected 'interface' but found 'foo' at line 5, column 1
```
