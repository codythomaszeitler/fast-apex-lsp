import * as vscode from 'vscode';
import * as path from 'path';
import {
  LanguageClientOptions,
  RevealOutputChannelOn,
  StateChangeEvent,
  State
} from 'vscode-languageclient';
const fs = require('fs').promises;

import { Trace } from 'vscode-languageserver-protocol';

import {
  LanguageClient,
  Executable,
  TransportKind
} from 'vscode-languageclient/node'

const UBER_JAR_NAME = 'apex-jorje-lsp.jar';
const JDWP_DEBUG_PORT = 2739;
const APEX_LANGUAGE_SERVER_MAIN = 'apex.jorje.lsp.ApexLanguageServerLauncher';

declare var v8debug: any;
const DEBUG = typeof v8debug === 'object' || startedInDebugMode();

export function activate(context: vscode.ExtensionContext) {

  Promise.resolve().then(() => {
    return createLanguageServer(context);
  }).then(async client => {
    client.registerProposedFeatures();
    client.onNotification('textDocument/publishDiagnostics', (event) => {
      console.log('we got a publish notification event');
    });

    client.start();
    await client.setTrace(Trace.Verbose);

    client.onDidChangeState(async (e: StateChangeEvent) => {
      if (e.newState === State.Running) {

        const uri = vscode.Uri.file("C:\\cygwin64\\home\\Cody\\dev\\salesforce-testing-area\\force-app\\main\\default\\classes\\ABCDEF.cls");
        const data = await fs.readFile(uri.fsPath, 'utf-8');

        const newUri = vscode.Uri.parse(uri.path);
        const response = await client.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri: newUri.toString(),
            languageId: 'apex',
            version: 10,
            text: data
          }
        });
        console.log(response);
      }
    });
  });
}

export function deactivate() { }

async function createServer(
  extensionContext: vscode.ExtensionContext
): Promise<Executable> {
  try {
    const uberJar = path.resolve(
      extensionContext.extensionPath,
      UBER_JAR_NAME
    );
    const javaExecutable = path.resolve(
      `C:\\Program Files\\Java\\jdk-20\\bin\\java`
    );
    const enableSemanticErrors: boolean = true;
    const enableCompletionStatistics: boolean = true;

    const args: string[] = [
      '-cp',
      uberJar,
      '-Ddebug.internal.errors=true',
      `-Ddebug.semantic.errors=${enableSemanticErrors}`,
      `-Ddebug.completion.statistics=${enableCompletionStatistics}`,
      '-Dlwc.typegeneration.disabled=true'
    ];

    if (DEBUG) {
      args.push(
        '-Dtrace.protocol=false',
        `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${JDWP_DEBUG_PORT},quiet=y`
      );
      if (process.env.YOURKIT_PROFILER_AGENT) {
        args.push(`-agentpath:${process.env.YOURKIT_PROFILER_AGENT}`);
      }
    }

    args.push(APEX_LANGUAGE_SERVER_MAIN);

    return {
      transport: TransportKind.stdio,
      command: javaExecutable,
      args
    };
  } catch (err) {
    vscode.window.showErrorMessage(err as string);
    throw err;
  }
}

function startedInDebugMode(): boolean {
  const args = (process as any).execArgv;
  if (args) {
    return args.some(
      (arg: any) =>
        /^--debug=?/.test(arg) ||
        /^--debug-brk=?/.test(arg) ||
        /^--inspect=?/.test(arg) ||
        /^--inspect-brk=?/.test(arg)
    );
  }
  return false;
}

// See https://github.com/Microsoft/vscode-languageserver-node/issues/105
export function code2ProtocolConverter(value: vscode.Uri) {
  if (/^win32/.test(process.platform)) {
    // The *first* : is also being encoded which is not the standard for URI on Windows
    // Here we transform it back to the standard way
    return value.toString().replace('%3A', ':');
  } else {
    return value.toString();
  }
}

function protocol2CodeConverter(value: string) {
  return vscode.Uri.parse(value);
}

export async function createLanguageServer(
  extensionContext: vscode.ExtensionContext
): Promise<LanguageClient> {
  const server = await createServer(extensionContext);
  const client = new LanguageClient(
    'apex',
    'Fast Apex Language Client',
    server,
    buildClientOptions()
  );

  return client;
}

// exported only for testing
export function buildClientOptions(): LanguageClientOptions {
  return {
    // Register the server for Apex documents
    documentSelector: [
      { language: 'apex', scheme: 'file'},
      { language: 'apex-anon', scheme: 'file'}
    ],
    synchronize: {
      configurationSection: 'apex',
      fileEvents: [
        vscode.workspace.createFileSystemWatcher('**/*.cls'), // Apex classes
        vscode.workspace.createFileSystemWatcher('**/*.trigger'), // Apex triggers
        vscode.workspace.createFileSystemWatcher('**/*.apex'), // Apex anonymous scripts
        vscode.workspace.createFileSystemWatcher('**/sfdx-project.json') // SFDX workspace configuration file
      ]
    },
    revealOutputChannelOn: RevealOutputChannelOn.Info,
    initializationOptions: {
      enableEmbeddedSoqlCompletion: false
    },
  };
}
