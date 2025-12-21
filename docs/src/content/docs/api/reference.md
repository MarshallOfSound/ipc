---
title: API Reference
description: CLI and programmatic API for EIPC code generation.
order: 1
---

## CLI

The `generate-ipc` command generates IPC wiring from your schema files.

```bash
generate-ipc <schemaDir> <outputDir> [--watch]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `schemaDir` | Directory containing `.eipc` schema files |
| `outputDir` | Output directory for generated code |
| `--watch` | Watch for changes and regenerate automatically |

### Example

```bash
# One-time generation
generate-ipc src/schema src/ipc

# Watch mode for development
generate-ipc src/schema src/ipc --watch
```

### Package.json Integration

```json
{
  "scripts": {
    "generate:ipc": "generate-ipc src/schema src/ipc",
    "generate:ipc:watch": "generate-ipc src/schema src/ipc --watch"
  }
}
```

## Programmatic API

For advanced use cases, you can use the programmatic API directly.

### generateWiring

One-time generation of IPC wiring:

```typescript
import { generateWiring } from '@marshallofsound/ipc';

await generateWiring({
  schemaFolder: './src/schema',
  wiringFolder: './src/ipc',
});
```

### watchWiring

Watch for schema changes and regenerate automatically. Returns a promise that resolves once the watcher is ready:

```typescript
import { watchWiring } from '@marshallofsound/ipc';

const watcher = await watchWiring({
  schemaFolder: './src/schema',
  wiringFolder: './src/ipc',
});

console.log('Watching for changes...');

watcher.on('change-detected', (file) => {
  console.log(`File changed: ${file}`);
});

watcher.on('generation-complete', () => {
  console.log('Regeneration complete');
});

watcher.on('generation-error', (error) => {
  console.error('Generation failed:', error.message);
});

// Stop watching when done
watcher.close();
```

### Watcher Events

| Event | Arguments | Description |
|-------|-----------|-------------|
| `change-detected` | `file: string` | A schema file was modified |
| `file-added` | `file: string` | A new schema file was created |
| `file-removed` | `file: string` | A schema file was deleted |
| `generation-start` | — | Generation is starting |
| `generation-complete` | — | Generation finished successfully |
| `generation-error` | `error: Error` | Generation failed |
| `error` | `error: Error` | Watcher encountered an error |

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
