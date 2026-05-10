import Table from 'cli-table3';

// Exit codes shared across every command.
export const EXIT = {
  OK: 0,
  ERROR: 1,
  AUTH: 2,
  NOT_FOUND: 3,
  VALIDATION: 4,
} as const;

export type GlobalFlags = {
  json?: boolean;
  quiet?: boolean;
  serverUrl?: string;
  token?: string;
  apiKey?: string;
};

export class CliError extends Error {
  constructor(
    message: string,
    public exitCode: number = EXIT.ERROR,
    public code?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

function isQuiet(flags: GlobalFlags | undefined): boolean {
  return Boolean(flags?.quiet);
}

function isJson(flags: GlobalFlags | undefined): boolean {
  return Boolean(flags?.json);
}

export function emitJson(value: unknown, flags?: GlobalFlags): void {
  if (isQuiet(flags)) return;
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function emitText(text: string, flags?: GlobalFlags): void {
  if (isQuiet(flags)) return;
  process.stdout.write(text + (text.endsWith('\n') ? '' : '\n'));
}

export function emitError(message: string): void {
  process.stderr.write(message + (message.endsWith('\n') ? '' : '\n'));
}

export type TableSpec = {
  head: string[];
  rows: (string | number | null | undefined)[][];
};

export function renderTable(spec: TableSpec): string {
  const t = new Table({ head: spec.head, style: { head: [] } });
  for (const row of spec.rows) {
    t.push(row.map((c) => (c === null || c === undefined ? '' : String(c))));
  }
  return t.toString();
}

/**
 * Run an async command body and translate thrown CliErrors into stderr+exit.
 * Centralises the "every command needs the same try/catch" boilerplate.
 */
export async function runCommand(
  flags: GlobalFlags | undefined,
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } catch (err) {
    if (err instanceof CliError) {
      if (isJson(flags)) {
        process.stdout.write(
          JSON.stringify(
            { success: false, error: { code: err.code ?? 'CLI_ERROR', message: err.message } },
            null,
            2,
          ) + '\n',
        );
      } else {
        emitError(`Error: ${err.message}`);
      }
      process.exit(err.exitCode);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (isJson(flags)) {
      process.stdout.write(
        JSON.stringify({ success: false, error: { code: 'INTERNAL', message } }, null, 2) + '\n',
      );
    } else {
      emitError(`Error: ${message}`);
    }
    process.exit(EXIT.ERROR);
  }
}

export function ageString(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
