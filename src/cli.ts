#!/usr/bin/env node

import * as path from 'node:path';
import { generateWiring, watchWiring } from './index.js';

const args = process.argv.slice(2);

// Check for --watch flag
const watchIndex = args.indexOf('--watch');
const isWatch = watchIndex !== -1;
if (isWatch) {
  args.splice(watchIndex, 1);
}

if (args.length !== 2) {
  console.error('Usage: generate-ipc <schemaDir> <outputDir> [--watch]');
  process.exit(1);
}

const [schemaDir, outputDir] = args;

const schemaFolder = path.resolve(process.cwd(), schemaDir);
const wiringFolder = path.resolve(process.cwd(), outputDir);

if (isWatch) {
  console.log(`Watching for schema changes in ${schemaFolder}...`);

  watchWiring({ schemaFolder, wiringFolder })
    .then((watcher) => {
      console.log('Watcher ready');

      watcher.on('change-detected', (file) => {
        console.log(`Change detected: ${file}`);
      });

      watcher.on('file-added', (file) => {
        console.log(`File added: ${file}`);
      });

      watcher.on('file-removed', (file) => {
        console.log(`File removed: ${file}`);
      });

      watcher.on('generation-start', () => {
        console.log('Generating...');
      });

      watcher.on('generation-complete', () => {
        console.log(`Generated IPC wiring in ${wiringFolder}`);
      });

      watcher.on('generation-error', (err) => {
        console.error('Generation error:', err.message);
      });

      watcher.on('error', (err) => {
        console.error('Watcher error:', err.message);
      });

      // Keep process alive and handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nStopping watcher...');
        watcher.close();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        watcher.close();
        process.exit(0);
      });
    })
    .catch((err) => {
      console.error('Failed to start watcher:', err.message);
      process.exit(1);
    });
} else {
  generateWiring({ schemaFolder, wiringFolder })
    .then(() => {
      console.log(`Generated IPC wiring in ${wiringFolder}`);
    })
    .catch((err) => {
      console.error('Error generating IPC wiring:', err.message);
      process.exit(1);
    });
}
