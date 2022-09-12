import * as fs from 'fs';
import type { Fifo } from './fifo-maker';
import * as addon from './addon';
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

const aread = (fd: number, buf: Buffer) =>
  new Promise<number>((resolve, reject) => {
    fs.read(fd, buf, 0, buf.byteLength, -1, (err, bytesRead) => {
      if (err) {
        reject(err);
      } else {
        resolve(bytesRead);
      }
    });
  });

export async function createAsyncFifoReader<T>(fifo: Fifo) {
  let fd: number;
  if (fifo.pipe) {
    addon.close(fifo.pipe.write);
    fd = fifo.pipe.read;
  } else {
    fd = fs.openSync(fifo.path, 'r');
  }

  const read = async (): Promise<T> => {
    // if (anything) {
    //   const buf = Buffer.alloc(1000);
    //   console.error('re', await fd.read(buf, null, 1));
    //   return {} as T;
    // }
    const prefix = Buffer.alloc(uniquePrefix.byteLength);
    await aread(fd, prefix);
    // if (fifo.id == 0) {
    //   console.error('got prefix', fifo.id);
    // }
    if (!prefix.equals(uniquePrefix)) {
      throw new Error(`invalid prefix "${prefix.toString('utf8')}"`);
    }

    const sizeBuf = Buffer.alloc(INT_SIZE);

    await aread(fd, sizeBuf);

    // if (fifo.id == 0) {
    //   console.error('got size', fifo.id);
    // }
    const length = sizeBuf.readUInt32LE();

    const dataBuf = Buffer.alloc(length);
    await aread(fd, dataBuf);

    return JSON.parse(dataBuf.toString('utf8'));
  };
  const closeFd = () => {
    addon.close(fd)
    return 
  };
  const getFd = () => {
    return fd
  }
  return { read, closeFd, getFd };
}

export function createSyncFifoReader<T>(fifo: Fifo) {
  let fd: number;
  if (fifo.pipe) {
    addon.close(fifo.pipe.write);
    fd = fifo.pipe.read;
  } else {
    fd = fs.openSync(fifo.path, 'r');
  }

  const read = (): T => {
    const prefix = Buffer.alloc(uniquePrefix.byteLength);
    fs.readSync(fd, prefix, { length: prefix.byteLength });
    // if (fifo.id == 0) {
    //   console.error('got prefix', fifo.id);
    // }
    if (!prefix.equals(uniquePrefix)) {
      throw new Error(`invalid prefix "${prefix.toString('utf8')}"`);
    }

    const sizeBuf = Buffer.alloc(INT_SIZE);

    fs.readSync(fd, sizeBuf, { length: sizeBuf.byteLength });
    // if (fifo.id == 0) {
    //   console.error('got size', fifo.id);
    // }
    const length = sizeBuf.readUInt32LE();

    const dataBuf = Buffer.alloc(length);
    fs.readSync(fd, dataBuf, { length: dataBuf.byteLength });

    return JSON.parse(dataBuf.toString('utf8'));
  };
  const closeFd = () => {
    addon.close(fd);
    // fs.closeSync(fd);
  };
  return { read, closeFd };
}

export async function createAsyncFifoWriter<T>(fifo: Fifo) {
  const serialize = (data: T) => {
    const buffer2 = Buffer.from(JSON.stringify(data), 'utf8');

    const buffer1 = Buffer.alloc(INT_SIZE);

    buffer1.writeUInt32LE(buffer2.byteLength);

    return Buffer.concat([uniquePrefix, buffer1, buffer2]);
  };

  if (fifo.pipe) {
    const write = async (data: T) => {
      const serialized = serialize(data);
      return new Promise<void>((resolve, reject) => {
        fs.write(fifo.pipe!.write, serialized, null, serialized.byteLength, null, (err, d) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
      
    };
    return { write };
  }

  const handle = fs.promises.open(fifo.path, 'w');

  let curPromise: Promise<{ bytesWritten: number }>;
  const write = async (data: T) => {
    const serialized = serialize(data);
    // await this.initPromise()
    if (curPromise) {
      await curPromise;
    }

    // console.error('writing!')
    const ha = await handle;
    // console.error('sending', data)
    curPromise = ha.write(serialized, null, serialized.byteLength, null);
    const { bytesWritten } = await curPromise;
    // console.log('written!')
    if (bytesWritten !== serialized.byteLength) {
      throw new Error('bytesWritten !== serialized.byteLength');
    }
  };
  return { write };
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
