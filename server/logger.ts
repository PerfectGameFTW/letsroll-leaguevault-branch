
import { Writable } from 'stream';

class ConsoleBuffer extends Writable {
  private buffer: string[] = [];
  
  constructor() {
    super();
    this.buffer = [];
  }

  _write(chunk: any, encoding: string, callback: (error?: Error) => void) {
    const timestamp = new Date().toISOString();
    const formattedLog = `[${timestamp}] ${chunk.toString()}`;
    this.buffer.push(formattedLog);
    process.stdout.write(formattedLog + '\n');
    callback();
  }

  toString() {
    return this.buffer.slice(-100).join('\n');
  }

  clear() {
    this.buffer = [];
  }
}

export const consoleBuffer = new ConsoleBuffer();

export interface Logger {
  info: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

function getMinLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL || 'debug').toLowerCase();
  if (env in LOG_LEVELS) return env as LogLevel;
  return 'debug';
}

function serializeArg(arg: any): any {
  if (arg instanceof Error) {
    return { message: arg.message, stack: arg.stack };
  }
  return arg;
}

function formatArgs(args: any[]): string {
  if (args.length === 0) return '';
  const serialized = args.map(serializeArg);
  if (serialized.length === 1 && typeof serialized[0] === 'object') {
    return ' ' + JSON.stringify(serialized[0]);
  }
  return ' ' + JSON.stringify(serialized);
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getMinLevel()];
}

function makeLogger(prefix?: string): Logger {
  const tag = prefix ? `[${prefix}] ` : '';
  return {
    info: (message: string, ...args: any[]) => {
      if (!shouldLog('info')) return;
      const log = `[INFO] ${tag}${message}${formatArgs(args)}`;
      consoleBuffer.write(Buffer.from(`${log}\n`));
    },
    error: (message: string, ...args: any[]) => {
      if (!shouldLog('error')) return;
      const log = `[ERROR] ${tag}${message}${formatArgs(args)}`;
      consoleBuffer.write(Buffer.from(`${log}\n`));
    },
    warn: (message: string, ...args: any[]) => {
      if (!shouldLog('warn')) return;
      const log = `[WARN] ${tag}${message}${formatArgs(args)}`;
      consoleBuffer.write(Buffer.from(`${log}\n`));
    },
    debug: (message: string, ...args: any[]) => {
      if (!shouldLog('debug')) return;
      const log = `[DEBUG] ${tag}${message}${formatArgs(args)}`;
      consoleBuffer.write(Buffer.from(`${log}\n`));
    },
  };
}

export const logger = makeLogger();

export function createLogger(prefix: string): Logger {
  return makeLogger(prefix);
}
