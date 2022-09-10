import * as fs from 'fs';
import type {Fifo} from './fifo-maker';

const uniquePrefix = Buffer.from(
  '42D#DER_sending_data_to_worker_#¬∂∂ƒ©˚∆∆˙∆D42',
);

const INT_SIZE = 4;

const assertWritten = (written: number, expected: number) => {
  if (written !== expected) {
    throw new Error(
      `Expected to write ${expected} bytes but only wrote ${written}`,
    );
  }
};

const read = (fd: number, buf: Buffer) =>
  new Promise<number>((resolve, reject) => {
    fs.read(fd, buf, 0, buf.byteLength, -1, (err, bytesRead) => {
      if (err) {
        reject(err);
      } else {
        resolve(bytesRead);
      }
    });
  });

export function createSyncFifoReader<T>(fifo: Fifo) {
  const fd = fs.openSync(fifo.path, 'r');

  const read = (): T => {
    const prefix = Buffer.alloc(uniquePrefix.byteLength);
    fs.readSync(fd, prefix, {length: prefix.byteLength});

    if (!prefix.equals(uniquePrefix)) {
      throw new Error(`invalid prefix "${prefix.toString('utf8')}"`);
    }

    const sizeBuf = Buffer.alloc(INT_SIZE);

    fs.readSync(fd, sizeBuf, {length: sizeBuf.byteLength});
    const length = sizeBuf.readUInt32LE();

    const dataBuf = Buffer.alloc(length);
    fs.readSync(fd, dataBuf, {length: dataBuf.byteLength});

    return JSON.parse(dataBuf.toString('utf8'));
  };
  const closeFd = () => {
    fs.closeSync(fd);
  }
  return {read, closeFd};
}

export async function createAsyncFifoWriter<T>(fifo: Fifo) {
  const stream = fs.createWriteStream(fifo.path, {flags: 'w'});

  const serialize = (data: T) => {
    const buffer2 = Buffer.from(JSON.stringify(data), 'utf8');

    const buffer1 = Buffer.alloc(INT_SIZE);

    buffer1.writeUInt32LE(buffer2.byteLength);

    return Buffer.concat([uniquePrefix, buffer1, buffer2]);
  };

  const write = async (data: T) => {
    const serialized = serialize(data);
    // await this.initPromise()
    return new Promise<void>((resolve, reject) => {
      stream.write(serialized, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  };
  return {write};
}

// write(data: T) {
//   const serialized = this.serialize(data);
//   const written = fs.writeSync(this.fd, serialized);
//   assertWritten(written, serialized.byteLength);
// }

// asyncInit() {
//   if (!this.initPromise) {
//     this.stream = fs.createWriteStream('not used asd', {fd: this.fd});

//     this.initPromise =
//   }
// }
