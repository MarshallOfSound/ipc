# Changelog

## Unreleased

- Much smaller generated output. The browser (main process) files now describe each interface as data - one row per method, store and event - and a shared `_internal/browser-runtime.ts` (shipped in the package's new `templates/` directory and copied into the wiring folder) registers the ipc handlers and builds the dispatcher, instead of emitting a closure with a pre-baked channel string and error message per handler. The preload files build channel names from a single per-module prefix constant instead of repeating the full channel string at every call site. Channel names, validation order, error text and the exported API are unchanged; for a schema with ~700 methods the minified browser output shrinks by roughly 90% and the preload output by roughly half, and registering handlers at startup does less work.
- The browser barrel now also exports an `I<Name>Dispatcher` type per interface describing what `setImplementation()` returns.

## 2.7.0

- Schema files can now live in nested subdirectories of the schema folder. `generateWiring` and `watchWiring` recursively scan the schema folder, and the watcher now picks up edits in subdirectories. The collected file list is sorted before parsing so the generated output is deterministic across filesystems.
