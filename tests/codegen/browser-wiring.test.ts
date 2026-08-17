import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';
import { generateWiring } from '../../src/index.js';

// Executes the generated browser (main process) wiring against a fake ipc
// target and asserts on observable behaviour: which channels get registered,
// what reaches the implementation, what is returned or sent, and the exact
// error text for every rejection path. The preload output for the same schema
// is loaded too, to check that both sides agree on channel names.

const schema = String.raw`module test.wiring

validator MainFrame = AND(
  is_main_frame is true
)

validator Packaged = AND(
  is_packaged is true
)

structure Item {
  id: number
  label?: string
}

[RendererAPI]
[Validator=MainFrame]
[Validator=Packaged]
[ContextBridge]
interface Things {
  Find(query: string, limit?: number) -> Item?
  Save(item: Item, tags: string[], meta: unknown)
  Count() -> number
  [Sync]
  VersionSync() -> string
  [Sync]
  ResetSync(hard: boolean)
  [Event]
  Changed(item: Item, reason?: string)
  [Store]
  selection() -> Item?
}
`;

type Handler = (event: any, ...args: any[]) => any;

class FakeTarget {
  handlers = new Map<string, Handler>();
  listeners = new Map<string, Handler>();
  sent: [string, any[]][] = [];
  log: string[] = [];
  ipc = {
    handle: (channel: string, fn: Handler) => {
      this.log.push('handle ' + channel);
      this.handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      this.log.push('removeHandler ' + channel);
      this.handlers.delete(channel);
    },
    on: (channel: string, fn: Handler) => {
      this.log.push('on ' + channel);
      this.listeners.set(channel, fn);
    },
    removeAllListeners: (channel: string) => {
      this.log.push('removeAllListeners ' + channel);
      this.listeners.delete(channel);
    },
  };
  send = (channel: string, ...args: any[]) => {
    this.sent.push([channel, args]);
  };
  invoke(suffix: string, event: any, ...args: any[]) {
    return this.handlers.get(channelFor(suffix))!(event, ...args);
  }
  async sendSync(suffix: string, event: any, ...args: any[]) {
    await this.listeners.get(channelFor(suffix))!(event, ...args);
    return event.returnValue;
  }
}

const mainFrame = (url = 'app://test/index.html') => ({ senderFrame: { url, parent: null }, returnValue: undefined as any });
const childFrame = () => ({ senderFrame: { url: 'app://test/iframe.html', parent: {} }, returnValue: undefined as any });

const app = { isPackaged: true };
let tmpDir: string;
let prefix: string; // '$eipc_message$_<uuid>_$_test.wiring_$_Things_$_'
let browser: any;
let rendererChannels: { invoke: string[]; sendSync: string[]; on: string[] };
const channelFor = (suffix: string) => prefix + suffix;

async function bundle(entry: string, electronStub: string): Promise<any> {
  const outfile = entry.replace(/\.ts$/, '.bundle.mjs');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
    plugins: [
      {
        name: 'stub-electron',
        setup(build) {
          build.onResolve({ filter: /^electron(\/renderer)?$/ }, () => ({ path: 'electron', namespace: 'stub' }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: electronStub, loader: 'js' }));
        },
      },
    ],
  });
  return import(pathToFileURL(outfile).href);
}

beforeAll(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eipc-browser-wiring-'));
  const schemaDir = path.join(tmpDir, 'schema');
  const wiringDir = path.join(tmpDir, 'ipc');
  await fs.promises.mkdir(schemaDir);
  await fs.promises.writeFile(path.join(schemaDir, 'api.eipc'), schema);
  await generateWiring({ schemaFolder: schemaDir, wiringFolder: wiringDir });

  (globalThis as any).__eipcApp = app;
  browser = await bundle(path.join(wiringDir, '_internal', 'browser', 'test.wiring.ts'), 'export const app = globalThis.__eipcApp;');

  // Load the preload side with an ipcRenderer that only records channel names.
  const recorded = { invoke: [] as string[], sendSync: [] as string[], on: [] as string[] };
  (globalThis as any).__eipcRecorded = recorded;
  const preload = await bundle(
    path.join(wiringDir, '_internal', 'preload', 'test.wiring.ts'),
    [
      'const r = globalThis.__eipcRecorded;',
      'export const ipcRenderer = {',
      '  invoke: (c) => { r.invoke.push(c); return Promise.resolve(); },',
      '  sendSync: (c) => { r.sendSync.push(c); return { result: undefined }; },',
      '  on: (c) => { r.on.push(c); },',
      '  removeListener: () => {},',
      '};',
      'export const contextBridge = { exposeInMainWorld: () => {} };',
      'export const webFrame = { top: null, routingId: 1 };',
    ].join('\n'),
  );
  const api = preload.Things;
  await api.Find('q');
  await api.Save({ id: 1 }, [], null);
  await api.Count();
  api.VersionSync();
  api.ResetSync(true);
  api.onChanged(() => {});
  await api.selectionStore.getState();
  api.selectionStore.getStateSync();
  api.selectionStore.onStateChange(() => {});
  rendererChannels = recorded;

  const first = recorded.invoke[0];
  prefix = first.slice(0, first.indexOf('Things_$_') + 'Things_$_'.length);
});

afterAll(async () => {
  if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// Registers Things on a fresh target. Every implementation method records its
// call; `overrides` replaces what a method returns (or throws).
function register(overrides: Record<string, () => any> = {}) {
  const target = new FakeTarget();
  const calls: [string, any[]][] = [];
  const returns: Record<string, () => any> = {
    Find: () => ({ id: 1 }),
    Save: () => 'ignored',
    Count: () => 3,
    VersionSync: () => '1.0',
    ResetSync: () => undefined,
    getInitialSelectionState: () => null,
    ...overrides,
  };
  const impl = Object.fromEntries(
    Object.entries(returns).map(([name, ret]) => [
      name,
      (...args: any[]) => {
        calls.push([name, args]);
        return ret();
      },
    ]),
  );
  const dispatcher = browser.Things.for(target).setImplementation(impl);
  return { target, calls, dispatcher };
}

describe('generated browser wiring (executed)', () => {
  it('registers one handler per method and store accessor, replacing stale ones first', () => {
    const { target } = register();
    expect(target.log).toEqual([
      `removeHandler ${channelFor('Find')}`,
      `handle ${channelFor('Find')}`,
      `removeHandler ${channelFor('Save')}`,
      `handle ${channelFor('Save')}`,
      `removeHandler ${channelFor('Count')}`,
      `handle ${channelFor('Count')}`,
      `removeAllListeners ${channelFor('VersionSync')}`,
      `on ${channelFor('VersionSync')}`,
      `removeAllListeners ${channelFor('ResetSync')}`,
      `on ${channelFor('ResetSync')}`,
      `removeHandler ${channelFor('selection_$store$_getState')}`,
      `handle ${channelFor('selection_$store$_getState')}`,
      `removeAllListeners ${channelFor('selection_$store$_getStateSync')}`,
      `on ${channelFor('selection_$store$_getStateSync')}`,
    ]);
  });

  it('uses the same channel names as the preload side', () => {
    const { target, dispatcher } = register();
    expect(prefix).toMatch(/^\$eipc_message\$_[0-9a-f-]{36}_\$_test\.wiring_\$_Things_\$_$/);
    expect([...target.handlers.keys()].sort()).toEqual([...rendererChannels.invoke].sort());
    expect([...target.listeners.keys()].sort()).toEqual([...rendererChannels.sendSync].sort());
    dispatcher.dispatchChanged({ id: 1 });
    dispatcher.updateSelectionStore(null);
    expect(target.sent.map(([channel]) => channel).sort()).toEqual([...rendererChannels.on].sort());
  });

  it('exposes the dispatcher through getDispatcher', () => {
    const { target, dispatcher } = register();
    expect(browser.Things.getDispatcher(target)).toBe(dispatcher);
    expect(browser.Things.getDispatcher(new FakeTarget())).toBeUndefined();
    expect(Object.keys(dispatcher)).toEqual(['dispatchChanged', 'updateSelectionStore']);
  });

  describe('async methods', () => {
    it('rejects callers that fail any origin validator', async () => {
      const { target, calls } = register();
      await expect(target.invoke('Find', childFrame(), 'q')).rejects.toThrow(
        `Incoming "Find" call on interface "Things" from 'app://test/iframe.html' did not pass origin validation`,
      );
      await expect(target.invoke('Count', { senderFrame: null })).rejects.toThrow(`from 'undefined' did not pass origin validation`);
      app.isPackaged = false;
      try {
        await expect(target.invoke('Count', mainFrame())).rejects.toThrow(
          `Incoming "Count" call on interface "Things" from 'app://test/index.html' did not pass origin validation`,
        );
      } finally {
        app.isPackaged = true;
      }
      expect(calls).toEqual([]);
    });

    it('checks the origin before looking at any argument', async () => {
      const { target, calls } = register();
      // every argument here is invalid too; the origin failure must win
      await expect(target.invoke('Find', childFrame(), 42, 'ten')).rejects.toThrow('did not pass origin validation');
      expect(await target.sendSync('ResetSync', childFrame(), 'not-a-boolean')).toEqual({
        error: `Incoming "ResetSync" call on interface "Things" from 'app://test/iframe.html' did not pass origin validation`,
      });
      await expect(target.invoke('selection_$store$_getState', childFrame(), 'unexpected')).rejects.toThrow('did not pass origin validation');
      expect(calls).toEqual([]);
    });

    it('validates each argument in order and reports the failing position', async () => {
      const { target, calls } = register();
      await expect(target.invoke('Find', mainFrame(), 42)).rejects.toThrow('Argument "query" at position 0 to method "Find" in interface "Things" failed to pass validation');
      await expect(target.invoke('Find', mainFrame(), 'q', 'ten')).rejects.toThrow(
        'Argument "limit" at position 1 to method "Find" in interface "Things" failed to pass validation',
      );
      await expect(target.invoke('Save', mainFrame(), { id: 'x' }, [], null)).rejects.toThrow('Argument "item" at position 0 to method "Save"');
      await expect(target.invoke('Save', mainFrame(), { id: 1 }, [1], null)).rejects.toThrow('Argument "tags" at position 1 to method "Save"');
      expect(calls).toEqual([]);
    });

    it('calls the implementation with exactly the declared arguments', async () => {
      const { target, calls } = register();
      await target.invoke('Find', mainFrame(), 'q');
      await target.invoke('Find', mainFrame(), 'q', 10, 'extra');
      await target.invoke('Save', mainFrame(), { id: 1, label: 'a' }, ['t'], { anything: true }, 'extra');
      expect(calls).toEqual([
        ['Find', ['q', undefined]],
        ['Find', ['q', 10]],
        ['Save', [{ id: 1, label: 'a' }, ['t'], { anything: true }]],
      ]);
    });

    it('validates the result, and returns undefined from void methods regardless of the implementation', async () => {
      const { target } = register({ Count: () => 'three' });
      await expect(target.invoke('Count', mainFrame())).rejects.toThrow('Result from method "Count" in interface "Things" failed to pass validation');
      await expect(target.invoke('Find', mainFrame(), 'q')).resolves.toEqual({ id: 1 });
      await expect(target.invoke('Save', mainFrame(), { id: 1 }, [], 0)).resolves.toBeUndefined();
      const nullable = register({ Find: () => null });
      await expect(nullable.target.invoke('Find', mainFrame(), 'q')).resolves.toBeNull();
    });

    it('propagates implementation errors unchanged', async () => {
      const { target } = register({
        Count: () => {
          throw new Error('boom');
        },
      });
      await expect(target.invoke('Count', mainFrame())).rejects.toThrow('boom');
    });
  });

  describe('sync methods', () => {
    it('reply through event.returnValue', async () => {
      const { target, calls } = register();
      expect(await target.sendSync('VersionSync', mainFrame())).toEqual({ result: '1.0' });
      expect(await target.sendSync('ResetSync', mainFrame(), true, 'extra')).toEqual({ result: undefined });
      expect(calls).toEqual([
        ['VersionSync', []],
        ['ResetSync', [true]],
      ]);
    });

    it('report every failure as { error } instead of throwing', async () => {
      const { target } = register({
        VersionSync: () => {
          throw 'not an Error';
        },
      });
      expect(await target.sendSync('ResetSync', childFrame(), true)).toEqual({
        error: `Incoming "ResetSync" call on interface "Things" from 'app://test/iframe.html' did not pass origin validation`,
      });
      expect(await target.sendSync('ResetSync', mainFrame(), 'yes')).toEqual({
        error: 'Argument "hard" at position 0 to method "ResetSync" in interface "Things" failed to pass validation',
      });
      expect(await target.sendSync('VersionSync', mainFrame())).toEqual({ error: 'not an Error' });
      const badResult = register({ VersionSync: () => 1 });
      expect(await badResult.target.sendSync('VersionSync', mainFrame())).toEqual({ error: 'Result from method "VersionSync" in interface "Things" failed to pass validation' });
    });
  });

  describe('stores', () => {
    it('serve the initial state on both channels with their own origin messages', async () => {
      const { target, calls } = register({ getInitialSelectionState: () => ({ id: 7 }) });
      await expect(target.invoke('selection_$store$_getState', mainFrame())).resolves.toEqual({ id: 7 });
      expect(await target.sendSync('selection_$store$_getStateSync', mainFrame())).toEqual({ result: { id: 7 } });
      expect(calls).toEqual([
        ['getInitialSelectionState', []],
        ['getInitialSelectionState', []],
      ]);
      await expect(target.invoke('selection_$store$_getState', childFrame())).rejects.toThrow(
        `Incoming "selection" store getState call on interface "Things" from 'app://test/iframe.html' did not pass origin validation`,
      );
      expect(await target.sendSync('selection_$store$_getStateSync', childFrame())).toEqual({
        error: `Incoming "selection" store getStateSync call on interface "Things" from 'app://test/iframe.html' did not pass origin validation`,
      });
    });

    it('validate the initial state and pushed updates', async () => {
      const { target, dispatcher } = register({ getInitialSelectionState: () => ({ id: 'x' }) });
      await expect(target.invoke('selection_$store$_getState', mainFrame())).rejects.toThrow(
        'Result from store "selection" getInitialState in interface "Things" failed to pass validation',
      );
      expect(await target.sendSync('selection_$store$_getStateSync', mainFrame())).toEqual({
        error: 'Result from store "selection" getInitialState in interface "Things" failed to pass validation',
      });
      expect(() => dispatcher.updateSelectionStore({ id: 'x' })).toThrow('State passed to updateSelectionStore in interface "Things" failed to pass validation');
      dispatcher.updateSelectionStore({ id: 2 });
      expect(target.sent).toEqual([[channelFor('selection_$store$_update'), [{ id: 2 }]]]);
    });
  });

  describe('events', () => {
    it('validate arguments and send exactly the declared ones', () => {
      const { target, dispatcher } = register();
      expect(() => dispatcher.dispatchChanged({ id: 'x' })).toThrow('Argument "item" at position 0 to event "Changed" in interface "Things" failed to pass validation');
      expect(() => dispatcher.dispatchChanged({ id: 1 }, 5)).toThrow('Argument "reason" at position 1 to event "Changed" in interface "Things" failed to pass validation');
      expect(target.sent).toEqual([]);
      dispatcher.dispatchChanged({ id: 1 });
      dispatcher.dispatchChanged({ id: 1 }, 'edited', 'extra');
      expect(target.sent).toEqual([
        [channelFor('Changed'), [{ id: 1 }, undefined]],
        [channelFor('Changed'), [{ id: 1 }, 'edited']],
      ]);
    });
  });
});
