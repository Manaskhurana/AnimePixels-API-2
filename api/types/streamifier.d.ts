declare module 'streamifier' {
  import { Readable } from 'stream';

  function createReadStream(buffer: Buffer, options?: any): Readable;

  export { createReadStream };
}
