---
name: verify
description: Build @marshallofsound/ipc, regenerate wiring, and drive the generated IPC in a real Electron app to observe a change end-to-end.
---

# Verify a change to @marshallofsound/ipc

The change lives in the generator (`src/`, `templates/`); the surface is the
generated wiring running inside Electron. Verify there, not with `yarn test`.

## Build + generate

```bash
yarn build                      # langium generate + tsc + typecheck templates/
node examples/build.js          # generates examples/simple/app/ipc + tsc's the example app (exit 0 = typechecks)
yarn test:e2e:build             # generates tests/e2e/test-app/ipc, bundles preload/renderer, tsc's main
node dist/cli.js <schemaDir> <outDir>   # CLI surface
```

Inspect output in `<out>/_internal/{browser,preload,browser-runtime.ts}`.

## Drive it in Electron

Electron cannot launch inside the Bash sandbox (`bootstrap_check_in ... Permission denied`,
SIGTRAP) - run Electron/Playwright commands with the sandbox disabled.

- Full e2e suite (3 projects: sandbox-off / sandbox-on / sandbox-off-cjs): `yarn playwright test`
- Ad-hoc drive: a small `.mjs` using `_electron.launch({ args: ['tests/e2e/test-app/dist/main.js'], env: { SANDBOX, USE_CJS, LOAD_URL: 'app://test' } })`,
  then `page.evaluate` against `window['e2e.test'].TestAPI` (methods, `.counterStore`, `onOnValueChanged`) and
  `app.evaluate(() => global.dispatchValueChanged(v) / global.updateCounter(n))` for main->renderer pushes.
  Inside `app.evaluate` there is no `require`/dynamic import; use
  `process.getBuiltinModule('module').createRequire(process.cwd() + '/x.js')(<abs path to dist/ipc/browser/e2e.test.js>)`.

## Size measurement

Bundle `<out>/_internal/browser/*.ts` and `preload/*.ts` with esbuild (`bundle, minify, external: ['electron','electron/renderer','zod']`)
and compare byte counts before/after; a synthetic schema with ~40 interfaces x 18 methods gives representative numbers.

## Gotchas

- `tests/watcher.test.ts` fails with `EMFILE` on this machine regardless of the change (fs.watch recursive) - not a signal.
- `yarn install` needs the sandbox off (registry blocked).
