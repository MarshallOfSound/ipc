# EIPC Language Support

Language support for Electron IPC schema files (`.eipc`).

## Features

- **Syntax highlighting** - Colors for keywords, types, strings, comments
- **Error diagnostics** - Real-time parse error detection
- **Auto-completion** - Suggests keywords, types, validators, tags
- **Hover information** - Shows type details on hover
- **Go to definition** - Jump to type, validator, and zod reference definitions

## Zod Reference Support

When using `zod_reference`, the extension provides go-to-definition support that navigates to the TypeScript source file containing your Zod schema:

```
zod_reference Email {
    import = "./schemas"
    type = "Email"
    schema = "emailSchema"
}
```

Ctrl+Click (Cmd+Click on Mac) on `Email` to jump to the TypeScript file.

## Development

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Watch for changes
npm run watch

# Package for distribution
npm run package
```

## Testing Locally

1. Open this folder in VS Code
2. Press F5 to launch Extension Development Host
3. Open a `.eipc` file to test
