import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ComputerInfo } from './ipc/browser/example.simple';

app.whenReady().then(() => {
  const window = new BrowserWindow({
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.resolve(__dirname, 'ipc-init.js'),
    },
  });
  window.loadURL('https://electronjs.org');

  ComputerInfo.for(window.webContents.mainFrame).setImplementation({
    async GetName(foo) {
      return foo;
    },
    async GetNameSync() {
      return 'sync-name';
    },
    async GetStuff() {
      return {
        name: 'stuff',
        gpuInfo: {
          name: 'gpu',
          year: 123,
          enabled: true,
        },
      };
    },
    async GetOptionalNumber() {
      return 42;
    },
    getInitialBlahState() {
      return 'initial-blah-state';
    },
    getInitialConnectionState() {
      return { connected: true, latency: 50 };
    },
    async SendMessage(type, payload) {
      console.log(`Received message of type: ${type}, payload: ${payload}`);
      return { success: true };
    },
  });
});
