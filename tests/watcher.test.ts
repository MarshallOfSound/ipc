import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateWiring, watchWiring } from '../src/index.js';

const VALID_SCHEMA = `module test

validator Always = AND(
  is_main_frame is true
)

[RendererAPI]
[Validator=Always]
[ContextBridge]
interface Test {
  getValue() -> string
}
`;

const INVALID_SCHEMA = `module test

invalid syntax here
`;

describe('watchWiring', () => {
  let tempDir: string;
  let schemaFolder: string;
  let wiringFolder: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eipc-test-'));
    schemaFolder = path.join(tempDir, 'schema');
    wiringFolder = path.join(tempDir, 'wiring');
    await fs.promises.mkdir(schemaFolder, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('initialization', () => {
    it('resolves once initial generation is complete', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });

      expect(fs.existsSync(path.join(wiringFolder, 'browser', 'test.ts'))).toBe(true);
      watcher.close();
    });

    it('creates schema folder if it does not exist', async () => {
      const newSchemaFolder = path.join(tempDir, 'new-schema');

      const watcher = await watchWiring({
        schemaFolder: newSchemaFolder,
        wiringFolder,
      });

      expect(fs.existsSync(newSchemaFolder)).toBe(true);
      watcher.close();
    });

    it('rejects if initial generation fails with invalid schema', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), INVALID_SCHEMA);

      await expect(watchWiring({ schemaFolder, wiringFolder })).rejects.toThrow();
    });
  });

  describe('change detection', () => {
    it('emits change-detected when a schema file is modified', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });

      // Give fs.watch time to stabilize
      await new Promise((resolve) => setTimeout(resolve, 100));

      const changePromise = new Promise<string>((resolve) => {
        watcher.on('change-detected', resolve);
      });

      // Modify the file
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA.replace('getValue', 'getNewValue'));

      const changedFile = await changePromise;
      expect(changedFile).toBe('test.eipc');

      watcher.close();
    });

    it('emits generation-complete after processing changes', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });

      // Give fs.watch time to stabilize
      await new Promise((resolve) => setTimeout(resolve, 100));

      const completePromise = new Promise<void>((resolve) => {
        watcher.on('generation-complete', resolve);
      });

      // Modify the file
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA.replace('getValue', 'getNewValue'));

      await completePromise;

      // Verify the change was applied (check the internal file which has the actual implementation)
      const content = await fs.promises.readFile(path.join(wiringFolder, '_internal', 'browser', 'test.ts'), 'utf8');
      expect(content).toContain('getNewValue');

      watcher.close();
    });
  });

  describe('file additions', () => {
    it('emits file-added when a new schema file is created', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });

      // Give fs.watch time to stabilize
      await new Promise((resolve) => setTimeout(resolve, 100));

      const addPromise = new Promise<string>((resolve) => {
        watcher.on('file-added', resolve);
      });

      // Add a new file
      await fs.promises.writeFile(path.join(schemaFolder, 'other.eipc'), VALID_SCHEMA.replace('module test', 'module other'));

      const addedFile = await addPromise;
      expect(addedFile).toBe('other.eipc');

      watcher.close();
    });

    it('generates wiring for newly added files', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });

      // Give fs.watch time to stabilize
      await new Promise((resolve) => setTimeout(resolve, 100));

      const completePromise = new Promise<void>((resolve) => {
        watcher.on('generation-complete', resolve);
      });

      // Add a new file
      await fs.promises.writeFile(path.join(schemaFolder, 'other.eipc'), VALID_SCHEMA.replace('module test', 'module other'));

      await completePromise;

      expect(fs.existsSync(path.join(wiringFolder, 'browser', 'other.ts'))).toBe(true);

      watcher.close();
    });
  });

  describe('file removals', () => {
    it('emits file-removed when a schema file is deleted', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);
      await fs.promises.writeFile(path.join(schemaFolder, 'other.eipc'), VALID_SCHEMA.replace('module test', 'module other'));

      const watcher = await watchWiring({ schemaFolder, wiringFolder });

      const removePromise = new Promise<string>((resolve) => {
        watcher.on('file-removed', resolve);
      });

      // Remove a file
      await fs.promises.unlink(path.join(schemaFolder, 'other.eipc'));

      const removedFile = await removePromise;
      expect(removedFile).toBe('other.eipc');

      watcher.close();
    });
  });

  describe('error handling', () => {
    it('emits generation-error when schema becomes invalid', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });

      // Give fs.watch time to stabilize
      await new Promise((resolve) => setTimeout(resolve, 100));

      const errorPromise = new Promise<Error>((resolve) => {
        watcher.on('generation-error', resolve);
      });

      // Make the schema invalid
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), INVALID_SCHEMA);

      const error = await errorPromise;
      expect(error).toBeInstanceOf(Error);

      watcher.close();
    });

    it('continues watching after generation error', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });

      // Give fs.watch time to stabilize
      await new Promise((resolve) => setTimeout(resolve, 100));

      // First, cause an error
      const errorPromise = new Promise<void>((resolve) => {
        watcher.on('generation-error', () => resolve());
      });
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), INVALID_SCHEMA);
      await errorPromise;

      // Then fix it
      const completePromise = new Promise<void>((resolve) => {
        watcher.on('generation-complete', resolve);
      });
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);
      await completePromise;

      // Verify generation succeeded
      expect(fs.existsSync(path.join(wiringFolder, 'browser', 'test.ts'))).toBe(true);

      watcher.close();
    });
  });

  describe('close', () => {
    it('stops watching after close is called', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });
      watcher.close();

      expect(watcher.closed).toBe(true);
    });

    it('does not emit events after close', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });
      watcher.close();

      let eventFired = false;
      watcher.on('change-detected', () => {
        eventFired = true;
      });

      // Modify the file after close
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA.replace('getValue', 'getNewValue'));

      // Wait a bit to ensure no events fire
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(eventFired).toBe(false);
    });
  });

  describe('debouncing', () => {
    it('debounces rapid changes into single generation', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });

      let generationCount = 0;
      watcher.on('generation-complete', () => {
        generationCount++;
      });

      // Rapid changes
      for (let i = 0; i < 5; i++) {
        await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA.replace('getValue', `getValue${i}`));
      }

      // Wait for debounce to settle
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Should have batched into fewer generations
      expect(generationCount).toBeLessThan(5);

      watcher.close();
    });
  });

  describe('ignores non-schema files', () => {
    it('does not trigger on non-.eipc files', async () => {
      await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

      const watcher = await watchWiring({ schemaFolder, wiringFolder });

      let eventFired = false;
      watcher.on('change-detected', () => {
        eventFired = true;
      });
      watcher.on('file-added', () => {
        eventFired = true;
      });

      // Create a non-schema file
      await fs.promises.writeFile(path.join(schemaFolder, 'readme.md'), '# Readme');

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(eventFired).toBe(false);

      watcher.close();
    });
  });
});

describe('generateWiring safety', () => {
  let tempDir: string;
  let schemaFolder: string;
  let wiringFolder: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eipc-safety-test-'));
    schemaFolder = path.join(tempDir, 'schema');
    wiringFolder = path.join(tempDir, 'wiring');
    await fs.promises.mkdir(schemaFolder, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('creates marker file in generated folder', async () => {
    await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

    await generateWiring({ schemaFolder, wiringFolder });

    const markerPath = path.join(wiringFolder, '.eipc-generated');
    expect(fs.existsSync(markerPath)).toBe(true);

    const content = await fs.promises.readFile(markerPath, 'utf8');
    expect(content).toContain('generated by EIPC');
  });

  it('allows regeneration when marker file exists', async () => {
    await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

    // First generation
    await generateWiring({ schemaFolder, wiringFolder });

    // Second generation should succeed
    await generateWiring({ schemaFolder, wiringFolder });

    expect(fs.existsSync(path.join(wiringFolder, 'browser', 'test.ts'))).toBe(true);
  });

  it('refuses to overwrite folder without marker file', async () => {
    await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

    // Create folder with user files (no marker)
    await fs.promises.mkdir(wiringFolder, { recursive: true });
    await fs.promises.writeFile(path.join(wiringFolder, 'important-file.ts'), 'do not delete');

    await expect(generateWiring({ schemaFolder, wiringFolder })).rejects.toThrow('was not created by EIPC');

    // User file should still exist
    expect(fs.existsSync(path.join(wiringFolder, 'important-file.ts'))).toBe(true);
  });

  it('error message suggests solutions', async () => {
    await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

    // Create folder without marker
    await fs.promises.mkdir(wiringFolder, { recursive: true });

    try {
      await generateWiring({ schemaFolder, wiringFolder });
      expect.fail('Should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('Delete it manually');
      expect(message).toContain('different output directory');
    }
  });

  it('works with empty folder without marker', async () => {
    await fs.promises.writeFile(path.join(schemaFolder, 'test.eipc'), VALID_SCHEMA);

    // Create empty folder (no marker)
    await fs.promises.mkdir(wiringFolder, { recursive: true });

    // Should still refuse - empty folder might be intentional
    await expect(generateWiring({ schemaFolder, wiringFolder })).rejects.toThrow('was not created by EIPC');
  });
});
