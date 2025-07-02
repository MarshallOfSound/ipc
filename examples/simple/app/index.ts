import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ComputerInfo } from './ipc/browser/example.simple';

ComputerInfo.setImplementation({
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
            }
        }
    },
    async GetOptionalNumber() {
        return 42;
    }
})

app.whenReady().then(() => {
    const window = new BrowserWindow({
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            preload: path.resolve(__dirname, 'ipc-init.js')
        },
    });
    window.loadURL('https://electronjs.org');
})