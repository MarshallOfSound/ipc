import { app, BrowserWindow, protocol, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { TestAPI, MainFrameAPI, OriginRestrictedAPI, DynamicGlobalAPI } from './ipc/browser/e2e.test';

let counterValue = 0;
let mainWindow: BrowserWindow | null = null;
let currentDispatcher: ReturnType<ReturnType<typeof TestAPI['for']>['setImplementation']> | null = null;

// Use SANDBOX=true to test with sandbox enabled (requires bundled preload)
const useSandbox = process.env.SANDBOX === 'true';
const preloadScript = useSandbox ? 'preload-bundled.js' : 'preload.js';

// Hide windows unless DEBUG_E2E_TEST=1
const showWindow = process.env.DEBUG_E2E_TEST === '1';

// LOAD_URL controls which URL to load initially:
// - 'file' or undefined: load from file:// protocol (default)
// - 'app://test': load from app://test/index.html
// - 'app://other': load from app://other/index.html
const loadUrl = process.env.LOAD_URL;

// Register custom protocol for testing origin validation
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

app.whenReady().then(async () => {
  // Register protocol handler for app:// URLs
  protocol.registerFileProtocol('app', (request, callback) => {
    const url = new URL(request.url);
    // app://test/index.html -> serve our test HTML
    // app://other/index.html -> serve different origin content
    // app://*/iframe.html -> serve iframe content
    if (url.pathname.endsWith('iframe.html')) {
      callback({ path: path.join(__dirname, '..', 'iframe.html') });
    } else {
      callback({ path: path.join(__dirname, '..', 'index.html') });
    }
  });

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: showWindow,
    webPreferences: {
      contextIsolation: true,
      sandbox: useSandbox,
      preload: path.join(__dirname, preloadScript),
      // Enable nodeIntegrationInSubFrames to test iframe preload behavior
      nodeIntegrationInSubFrames: true,
    },
  });

  // Function to set up all handlers for a given frame
  const setupHandlers = (frame: Electron.WebFrameMain) => {
    currentDispatcher = TestAPI.for(frame).setImplementation({
      GetValue() {
        return 'test-value';
      },
      GetValueSync() {
        return 42;
      },
      ThrowingSyncMethod() {
        throw new Error('Intentional error from sync method');
      },
      getInitialCounterState() {
        return counterValue;
      },
      ValidateUsername(name) {
        return true;
      },
      ValidateNumber(num) {
        return true;
      },
      ValidateBoundedNumber(num) {
        return true;
      },
    });

    MainFrameAPI.for(frame).setImplementation({
      MainFrameOnlyMethod() {
        return 'main-frame-success';
      },
    });

    OriginRestrictedAPI.for(frame).setImplementation({
      OriginRestrictedMethod() {
        return 'origin-check-passed';
      },
    });

    DynamicGlobalAPI.for(frame).setImplementation({
      DynamicGlobalMethod() {
        return 'dynamic-global-success';
      },
    });
  };

  // Set up handlers for initial frame
  setupHandlers(mainWindow.webContents.mainFrame);

  // Re-register handlers when frame changes (e.g., navigation to custom protocol)
  mainWindow.webContents.on('did-frame-navigate', (event, url, httpResponseCode, httpStatusText, isMainFrame, frameProcessId, frameRoutingId) => {
    if (isMainFrame) {
      setupHandlers(mainWindow!.webContents.mainFrame);
    }
  });

  // Expose functions for test control
  (global as any).updateCounter = (value: number) => {
    counterValue = value;
    currentDispatcher?.updateCounterStore(value);
  };

  (global as any).dispatchValueChanged = (value: string) => {
    currentDispatcher?.dispatchOnValueChanged(value);
  };

  (global as any).setDynamicGlobal = (value: boolean) => {
    (global as any).testGlobalFlag = value;
  };

  (global as any).loadUrl = (url: string) => {
    mainWindow?.loadURL(url);
  };

  (global as any).loadTestPage = () => {
    mainWindow?.loadFile(path.join(__dirname, '..', 'index.html'));
  };

  (global as any).loadAppProtocol = (hostname: string) => {
    mainWindow?.loadURL(`app://${hostname}/index.html`);
  };

  // Load initial test page based on LOAD_URL env var
  if (loadUrl && loadUrl.startsWith('app://')) {
    mainWindow.loadURL(`${loadUrl}/index.html`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
