import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import {
  LanguageClientOptions,
  RevealOutputChannelOn
} from 'vscode-languageclient';
import { Trace } from 'vscode-languageserver-protocol';
import {
  LanguageClient,
  Executable,
  TransportKind
} from 'vscode-languageclient/node'

interface RequirementsData {
  java_home: string;
  java_memory: number | null;
}

const JAVA_HOME_KEY = 'salesforcedx-vscode-apex.java.home';
const JAVA_MEMORY_KEY = 'salesforcedx-vscode-apex.java.memory';
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
      const diags : vscode.Diagnostic[] = [];
      const uri = vscode.Uri.file(vscode.Uri.parse(event.uri).path);
      if (client && client.diagnostics) {
        event.diagnostics.forEach((diag: any) => {
          const message = diag.message;
          const lspRange = diag.range;
          const _start = new vscode.Position(lspRange.start.line, lspRange.start.character);
          const _end = new vscode.Position(lspRange.end.line, lspRange.end.character);

          const _range = new vscode.Range(_start, _end);
          const _diag = new vscode.Diagnostic(_range, message);
          diags.push(_diag);
        });

        client?.diagnostics?.set(uri, diags);
      }
    });

    await client.setTrace(Trace.Verbose);
    client.start();
  });
}

export function deactivate() { }

async function createServer(
  extensionContext: vscode.ExtensionContext
): Promise<Executable> {
  try {
    const requirements = await resolveRequirements();
    const uberJar = path.resolve(
      extensionContext.extensionPath,
      UBER_JAR_NAME
    );
    const javaExecutable = path.resolve(
      `${requirements.java_home}/bin/java`
    );

    const enableSemanticErrors: boolean = vscode.workspace
      .getConfiguration()
      .get<boolean>('salesforcedx-vscode-apex.enable-semantic-errors', false);
    const enableCompletionStatistics: boolean = vscode.workspace
      .getConfiguration()
      .get<boolean>(
        'salesforcedx-vscode-apex.advanced.enable-completion-statistics',
        false
      );

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
      { language: 'apex', scheme: 'file' },
      { language: 'apex-anon', scheme: 'file' }
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

export async function resolveRequirements(): Promise<RequirementsData> {
  const javaHome = await checkJavaRuntime();
  const javaMemory: number | null = vscode.workspace
    .getConfiguration()
    .get<number | null>(JAVA_MEMORY_KEY, null);
  return Promise.resolve({
    java_home: javaHome,
    java_memory: javaMemory
  });
}

function checkJavaRuntime(): Promise<string> {
  return new Promise((resolve, reject) => {
    let javaHome: string | undefined = readJavaConfig();
    resolve(javaHome);
  });
}

function readJavaConfig(): string {
  const config = vscode.workspace.getConfiguration();
  return config.get<string>(JAVA_HOME_KEY, '');
}