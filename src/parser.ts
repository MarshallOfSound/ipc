import * as fs from 'node:fs';
import * as path from 'node:path';

import * as peg from 'peggy';

function findGrammarPath(): string {
  // Try from source (src/parser.ts -> parser/eipc.pegjs)
  const fromSource = path.resolve(__dirname, '..', 'parser', 'eipc.pegjs');
  if (fs.existsSync(fromSource)) return fromSource;

  // Try from compiled (dist/cjs/parser.js -> parser/eipc.pegjs)
  const fromDist = path.resolve(__dirname, '..', '..', 'parser', 'eipc.pegjs');
  if (fs.existsSync(fromDist)) return fromDist;

  throw new Error(`Could not find eipc.pegjs grammar file. Searched:\n  ${fromSource}\n  ${fromDist}`);
}

export async function getParser() {
  const grammarPath = findGrammarPath();
  const grammar = await fs.promises.readFile(grammarPath, 'utf8');

  return peg.generate(grammar);
}
