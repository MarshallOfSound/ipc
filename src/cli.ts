#!/usr/bin/env node

import * as path from 'node:path';
import { generateWiring } from './index.js';

const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error('Usage: generate-ipc <schemaDir> <outputDir>');
  process.exit(1);
}

const [schemaDir, outputDir] = args;

const schemaFolder = path.resolve(process.cwd(), schemaDir);
const wiringFolder = path.resolve(process.cwd(), outputDir);

generateWiring({ schemaFolder, wiringFolder })
  .then(() => {
    console.log(`Generated IPC wiring in ${wiringFolder}`);
  })
  .catch((err) => {
    console.error('Error generating IPC wiring:', err.message);
    process.exit(1);
  });
