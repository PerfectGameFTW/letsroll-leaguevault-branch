
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

export const logger = {
  info: (message: string, ...args: any[]) => {
    const log = `[INFO] ${message} ${args.length ? JSON.stringify(args) : ''}`;
    consoleBuffer.write(Buffer.from(`${log}\n`));
  },
  error: (message: string, ...args: any[]) => {
    const log = `[ERROR] ${message} ${args.length ? JSON.stringify(args) : ''}`;
    consoleBuffer.write(Buffer.from(`${log}\n`));
  },
  warn: (message: string, ...args: any[]) => {
    const log = `[WARN] ${message} ${args.length ? JSON.stringify(args) : ''}`;
    consoleBuffer.write(Buffer.from(`${log}\n`));
  },
  debug: (message: string, ...args: any[]) => {
    const log = `[DEBUG] ${message} ${args.length ? JSON.stringify(args) : ''}`;
    consoleBuffer.write(Buffer.from(`${log}\n`));
  }
};
