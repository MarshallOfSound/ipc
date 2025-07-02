import * as fs from 'node:fs';
import * as path from 'node:path';

import * as peg from 'peggy';

export async function getParser() {
  const grammarPath = path.resolve(__dirname, '..', '..', 'parser', 'eipc.pegjs');
  const grammar = await fs.promises.readFile(grammarPath, 'utf8');

  return peg.generate(grammar);
}
