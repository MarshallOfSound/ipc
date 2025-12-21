---
title: Validators
description: Secure your IPC APIs with validators that control access based on origin, environment, and custom conditions.
order: 2
---

Validators are security rules that control when APIs are exposed and when calls are allowed. They run both at preload time (to decide whether to expose the API via contextBridge) and at call time (to verify each request).

## Basic Syntax

Validators use `AND` and `OR` combinators with conditions:

```eipc
validator MyValidator = AND(
  condition1
  condition2
  OR(
    condition3
    condition4
  )
)
```

## Available Conditions

| Condition | Description |
|-----------|-------------|
| `is_packaged is true/false` | Check if app is packaged (production) or running from source |
| `is_main_frame is true/false` | Check if request comes from main frame (not iframe) |
| `origin is "https://example.com"` | Check the page origin (supports custom protocols like `app://`) |
| `hostname is "localhost"` | Check the hostname |
| `protocol is "https:"` | Check the protocol |
| `dynamic_global(flagName)` | Check if `global.flagName` is truthy in main process |

## Examples

### Production-Only API

Restrict an API to only work in packaged (production) builds:

```eipc
validator ProductionOnly = AND(
  is_packaged is true
)
```

### Origin Restriction

Only allow calls from your app's domain:

```eipc
validator OnlyMyApp = AND(
  origin is "https://myapp.com"
  is_main_frame is true
)
```

### Custom Protocol

For Electron apps using custom protocols:

```eipc
validator OnlyAppProtocol = AND(
  origin is "app://myapp"
  is_main_frame is true
)
```

### Multiple Origins

Allow multiple origins using `OR`:

```eipc
validator TrustedOrigins = AND(
  is_main_frame is true
  OR(
    origin is "https://myapp.com"
    origin is "https://admin.myapp.com"
    hostname is "localhost"
  )
)
```

### Development Localhost

Allow localhost during development:

```eipc
validator LocalDev = AND(
  is_packaged is false
  hostname is "localhost"
)
```

### Dynamic Feature Flags

Check runtime flags set in the main process:

```eipc
validator FeatureEnabled = AND(
  dynamic_global(myFeatureFlag)
  is_main_frame is true
)
```

In your main process, set the flag:

```typescript
// Enable the feature
(global as any).myFeatureFlag = true;
```

## Environment-Specific Validators

Define different rules for production and development:

```eipc
validator MyValidator = {
  production: AND(
    is_packaged is true
    origin is "https://myapp.com"
  )
  development: AND(
    is_packaged is false
    OR(
      hostname is "localhost"
      protocol is "file:"
    )
  )
}
```

The environment is determined by `EIPC_ENV` or `NODE_ENV` at **build time**. This is not a runtime check.

## Using Validators

Apply a validator to an interface using the `[Validator=Name]` attribute:

```eipc
validator OnlyMyApp = AND(
  origin is "https://myapp.com"
  is_main_frame is true
)

[RendererAPI]
[Validator=OnlyMyApp]
[ContextBridge]
interface SecureAPI {
  getSensitiveData() -> string
  deleteSomething(id: number)
}
```

All methods in the interface will be protected by this validator.

## How Validators Work

1. **At preload time**: The validator runs to decide if the API should be exposed via `contextBridge`. If the validator fails, the API is not exposed at all.

2. **At call time**: The validator runs again on every IPC call. If it fails, the call is rejected with an error.

This dual-check ensures security even if conditions change after page load.

## Best Practices

1. **Always use `is_main_frame is true`** to prevent iframes from accessing your APIs
2. **Be specific with origins** rather than allowing broad access
3. **Use environment-specific validators** to have strict production rules while allowing development flexibility
4. **Combine conditions** for defense-in-depth security

## Next Steps

- [Types](/ipc/docs/schema-language/types) — Define validated types for your APIs
- [Interfaces](/ipc/docs/interfaces/overview) — Create your API surface
