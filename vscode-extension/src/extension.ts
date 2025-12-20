import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const serverModule = context.asAbsolutePath(path.join('dist', 'language-server.cjs'));

  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'eipc' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.eipc'),
    },
  };

  client = new LanguageClient('eipc-language-server', 'EIPC Language Server', serverOptions, clientOptions);

  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (client) {
    return client.stop();
  }
  return undefined;
}
