
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

function formatArgs(args: any[]): string {
  if (args.length === 0) return '';
  if (args.length === 1 && typeof args[0] === 'object') {
    return ' ' + JSON.stringify(args[0]);
  }
  return ' ' + JSON.stringify(args);
}

function makeLogger(prefix?: string): Logger {
  const tag = prefix ? `[${prefix}] ` : '';
  return {
    info: (message: string, ...args: any[]) => {
      const log = `[INFO] ${tag}${message}${formatArgs(args)}`;
      consoleBuffer.write(Buffer.from(`${log}\n`));
    },
    error: (message: string, ...args: any[]) => {
      const log = `[ERROR] ${tag}${message}${formatArgs(args)}`;
      consoleBuffer.write(Buffer.from(`${log}\n`));
    },
    warn: (message: string, ...args: any[]) => {
      const log = `[WARN] ${tag}${message}${formatArgs(args)}`;
      consoleBuffer.write(Buffer.from(`${log}\n`));
    },
    debug: (message: string, ...args: any[]) => {
      const log = `[DEBUG] ${tag}${message}${formatArgs(args)}`;
      consoleBuffer.write(Buffer.from(`${log}\n`));
    },
  };
}

export const logger = makeLogger();

export function createLogger(prefix: string): Logger {
  return makeLogger(prefix);
}
