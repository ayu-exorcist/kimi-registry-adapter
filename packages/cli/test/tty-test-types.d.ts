import 'node:tty';

declare module 'node:tty' {
  interface ReadStream {
    /** Test-only helper: TTY doubles are backed by writable PassThrough streams. */
    write(chunk: string | Uint8Array): boolean;
  }
}
