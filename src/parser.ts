import * as fs from 'fs-extra';
import * as path from 'path';
import * as peg from 'peggy';

export async function getParser() {
  const grammarPath = path.resolve(__dirname, '..', '..', 'parser', 'eipc.pegjs');
  const grammar = await fs.readFile(grammarPath, 'utf8');

  return peg.generate(grammar);
}
