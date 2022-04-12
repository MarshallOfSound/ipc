# @electron/ipc

> Experimental IPC module for Electron, provides type safe, validated and
> secure IPC messaging with zero boilerplate

## What is this module?

This serves to solve the primary use case of Electron's IPC layer, namely
exposing an API or set of APIs from the privileged main process to a
sandboxed / less privileged renderer process.

Normally apps end up building their own boilerplate to solve this use case
using `ipcMain.handle` and `ipcRenderer.invoke`.  These primitives are
incredibly powerful and allow app developers to do pretty much whatever
they want.  But for folks that expose 10s to 100s of APIs to their
application the boilerplate can become a massive maintenance burden along
with being a nasty code smell due to the excessive duplication.

App developers also typically don't validate their IPC messages, either their
structure or their origin.  This leads to insecure-by-default IPC which is not
a good position to be in.

This module solves a lot of problems listed above by:

* Completely eliminating `invoke` / `handle` boilerplate
* Validation as a first party concept, all invalid messages are dropped
* Origin validation as a first party concept, messages from unexpected origins are dropped
* Automated `contextBridge` exposure to completely remove the final step of boilerplate
* Type safety via generated typescript files in addition to runtime IPC validation

## How do I use it?

For now the docs are WIP while the module is being worked on, a very sketchy example is
provided in `examples/simple`.  You can run this example by using this command locally.

```bash
yarn build && node examples/build.js && yarn electron examples/simple/dist
```

The developer UX needs work so don't expect the current example to be "how to use it"
going forward.

## How does it work?

`@electron/ipc` takes a set of `.eipc` schema files and generates a collection of
typescript files for you to use in your project.  This means that your build system
needs to support Typescript.

These files are generated into a folder structure like below.

```bash
my-app/ipc
├── _internal
│   ├── browser
│   │   └── example.simple.ts
│   ├── common
│   │   └── example.simple.ts
│   └── renderer
│       └── example.simple.ts
├── browser
│   └── example.simple.ts
├── common
│   └── example.simple.ts
└── renderer
    └── example.simple.ts
```

The `_internal` folder should be completely ignored, consuming it directly is unsupported
and messing with the generated internals is very inadvisable.

For each schema in your schemas folder a `{module_name}.ts` file will be generated in
`browser`, `common` and `renderer`.  Similar to other Electron modules the `browser`
folder should only be consumed from the main process, `common` can be consumed from
either process and `renderer` should only be consumed from a renderer process.

Structures / type aliases will be exported from `common` whereas the APIs themselves
be exposed via `browser` / `renderer` files.

For instance given a hello world schema file.

```txt
module helloworld

validator OnlyExample = AND(
    origin is "https://example.com"
)

[RendererAPI]
[Validator=OnlyExample]
[ContextBridge]
interface Greeter {
    Say(name: string) -> string
}
```

We will generate APIs that you consume like so.

```ts
// This code runs in the main process

// Greeter is the "interface" name
// "ipc" is the folder our wiring was generated in
// "helloworld" is our module name from our schema file
import { Greeter } from './ipc/browser/helloworld';

// In order for this API to be consumable from a renderer we must
// provide an actual implementation
Greeter.setImplementation({
    Say(name: string) {
        return `Hello World! ${name}`;
    },
});

// Typescript will validate the implementation we have provided is accurate
// We will validate that Say() returns the expected type at runtime as well
```

```ts
// This code runs in the preload script
// Currently you must load the renderer entry point manually to initialize
// in the future we may make this more automatic
import './ipc/renderer/helloworld';
```

```ts
// This code runs in devtools / on your webpage (in this case example.com)

// "helloworld" is our module name from our schema file
// "Greeter" is the "interface" name we want to call into
window.helloworld.Greeter.Say()
    .then((result) => console.log(result))
    .catch((err) => console.error(err))

// This is not currently type safe, you can get "IGreeterRenderer" as an interface type
// though and assign "Greeter" to that type to obtain type safety.  At some point
// in the future we may correctly augment the Window interface to ensure type safety.
```

Under the hood this uses `ipcMain.handle/invoke` and validates arguments / return values
at every stage along with only exposing / responding to messages in valid origins.  In this
example if you navigated to `electronjs.org` the API would not be exposed, navigating back to
`example.com` would re-expose it.

## Schema Syntax

Documentation on this is coming soon, currently the example in `examples/simple` covers most
of the supported syntax.

## API

```js
import { generateWiring } from '@electron/ipc';

generateWiring({
    // Absolute path to a folder containing valid ".eipc" schema files
    schemaFolder: path.resolve(__dirname, 'schemas'),
    // Absolute path to a folder to generate the IPC wiring in
    wiringFolder: path.resolve(__dirname, 'src', 'ipc'),
}).then(() => {
    console.log('Wiring generated');
}).catch((err) => {
    console.error('Wiring generation failed:', err);
});
```
