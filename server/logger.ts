
import { Writable } from 'stream';

class ConsoleBuffer extends Writable {
  private buffer: string[] = [];
  
  constructor() {
    super();
    this.buffer = [];
  }

  _write(chunk: any, encoding: string, callback: (error?: Error) => void) {
    this.buffer.push(chunk.toString());
    process.stdout.write(chunk, encoding);
    callback();
  }

  toString() {
    return this.buffer.join('');
  }

  clear() {
    this.buffer = [];
  }
}

export const consoleBuffer = new ConsoleBuffer();

export const logger = {
  info: (message: string, ...args: any[]) => {
    const log = `[INFO] ${message} ${args.length ? JSON.stringify(args) : ''}`;
    consoleBuffer.write(`${log}\n`);
  },
  error: (message: string, ...args: any[]) => {
    const log = `[ERROR] ${message} ${args.length ? JSON.stringify(args) : ''}`;
    consoleBuffer.write(`${log}\n`);
  },
  warn: (message: string, ...args: any[]) => {
    const log = `[WARN] ${message} ${args.length ? JSON.stringify(args) : ''}`;
    consoleBuffer.write(`${log}\n`);
  },
  debug: (message: string, ...args: any[]) => {
    const log = `[DEBUG] ${message} ${args.length ? JSON.stringify(args) : ''}`;
    consoleBuffer.write(`${log}\n`);
  }
};
