# Changelog

## 2.7.0

- Schema files can now live in nested subdirectories of the schema folder. `generateWiring` and `watchWiring` recursively scan the schema folder, and the watcher now picks up edits in subdirectories. The collected file list is sorted before parsing so the generated output is deterministic across filesystems.
