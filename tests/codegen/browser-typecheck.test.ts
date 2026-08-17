import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { generateWiring } from '../../src/index.js';

// The browser rows are plain data, so the type-safety the old per-method
// closures got from calling `impl.<method>(...)` directly now comes from the
// runtime's signature: row names are checked against I<Name>Impl /
// I<Name>Renderer / I<Name>Dispatcher. This test compiles the generated
// browser file (and the runtime it imports) under strict settings and checks
// that a row naming something the implementation does not have is rejected.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const schema = `module test.typecheck

validator MainFrame = AND(
  is_main_frame is true
)

structure Item {
  id: number
}

[RendererAPI]
[Validator=MainFrame]
interface Things {
  Find(query: string) -> Item?
  [Sync]
  ResetSync(hard: boolean)
  [Event]
  Changed(item: Item)
  [Store]
  selection() -> Item?
}
`;

let tmpDir: string;
let browserFile: string;

function diagnosticsFor(rootFile: string): string[] {
  const program = ts.createProgram([rootFile], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    types: [],
    baseUrl: tmpDir,
    paths: { electron: [path.join(repoRoot, 'node_modules', 'electron', 'electron.d.ts')] },
  });
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

beforeAll(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eipc-browser-typecheck-'));
  const schemaDir = path.join(tmpDir, 'schema');
  await fs.promises.mkdir(schemaDir);
  await fs.promises.writeFile(path.join(schemaDir, 'api.eipc'), schema);
  await generateWiring({ schemaFolder: schemaDir, wiringFolder: path.join(tmpDir, 'ipc') });
  browserFile = path.join(tmpDir, 'ipc', '_internal', 'browser', 'test.typecheck.ts');
});

afterAll(async () => {
  if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('generated browser wiring (type-checked)', () => {
  it('compiles cleanly under strict settings together with the browser runtime', () => {
    expect(diagnosticsFor(browserFile)).toEqual([]);
  });

  it('rejects rows that name a method, store or event the interface does not declare', async () => {
    const source = await fs.promises.readFile(browserFile, 'utf8');
    const cases: [string, string, string][] = [
      ["['Find', [['query', $eipc$.string]]", "['Fnd', [['query', $eipc$.string]]", `Type '"Fnd"' is not assignable`],
      ["['selection', ", "['selektion', ", `Type '"selektion"' is not assignable`],
      ["['Changed', [['item', ", "['Chnged', [['item', ", `Type '"Chnged"' is not assignable`],
    ];
    for (const [needle, replacement, expectedError] of cases) {
      expect(source).toContain(needle);
      const broken = path.join(path.dirname(browserFile), 'broken.ts');
      await fs.promises.writeFile(broken, source.replace(needle, replacement));
      const diagnostics = diagnosticsFor(broken);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics.join('\n')).toContain(expectedError);
    }
  });
});
