import * as net from 'net';
import { debugLog } from './log';

type Payload<T> =
  | {
      counter: number;
      kind: 'payload';
      data: T;
    }
  | {
      sent: number;
      kind: 'ping';
    }
  | {
      kind: 'stop';
    };

const DELIMITER = '\n';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createMultiConServer<T>(
  socketPath: string,
  onResp: (data: T) => void,
) {
  const server = net
    .createServer((stream) => {
      let wholeData = '';
      stream.on('data', (msg) => {
        wholeData += msg.toString();
      });
      stream.on('end', () => {
        onResp(JSON.parse(wholeData));
      });
    })
    .listen(socketPath);

  return {
    stop: () => {
      server.close();
    },
  };
}

export async function sendRequest<T>(socketPath: string, d: T) {
  return new Promise<void>((resolve) => {
    const client = net.createConnection(socketPath, () => {
      const str = JSON.stringify(d);
      client.end(str, 'utf8', resolve);
    });
  });
}

export async function createServer<T>(socketPath: string) {
  // connec
  let counter = 0;
  let closing = false;
  let _resolve: (socket: net.Socket) => void;
  const connected = new Promise<net.Socket>((resolve) => {
    _resolve = resolve;
  });
  const server = net
    .createServer((stream) => {
      _resolve(stream);
      //   stream.on('data', (_msg) => {
      //     const msg = _msg.toString();
      //   });
    })
    .listen(socketPath);

  const _write = async (payload: Payload<unknown>, end?: boolean) => {
    const socket = await connected; //todo await prev req?
    const serialized = JSON.stringify(payload) + DELIMITER;

    await new Promise<void>((resolve, reject) =>
      socket.write(serialized, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }),
    );
    if (end) {
      await new Promise<void>((resolve) => socket.end(resolve));
    }
  };

  const stop = async () => {
    closing = true;
    await _write({ kind: 'stop' });
    server.close();
  };
  const write = async (data: T) => {
    const payload: Payload<T> = {
      data,
      counter: counter++,
      kind: 'payload',
    };
    await _write(payload);
  };

  const pingPong = async () => {
    while (true) {
      if (closing) {
        return;
      }
      await _write({
        sent: Date.now(),
        kind: 'ping',
      });
      await sleep(1000);
    }
  };

  pingPong();

  return { write, stop };
}

async function* splitByNewline(gen: {
  [Symbol.asyncIterator](): AsyncGenerator<any, any, void>;
}) {
  let soFar: string | undefined = undefined;

  for await (const data of gen) {
    const parts: string[] = ((soFar ?? '') + data).split(DELIMITER);
    soFar = parts.pop();

    for (const part of parts) {
      yield part;
    }
  }
}

export async function connectToServer<T>(socketPath: string) {
  let counter = 0;

  const client = net.createConnection(socketPath, () => {
    debugLog('connected');
  });

  async function* gen() {
    for await (const d of splitByNewline(client as any)) {
      const msg = JSON.parse(d) as Payload<T>;

      if (msg.kind === 'ping') {
        debugLog('ping');
        continue;
      } else if (msg.kind === 'stop') {
        return;
      } else {
        if (msg.counter !== counter++) {
          throw new Error(`invalid counter ${msg.counter} expected ${counter}`);
        }
        client.pause();
        yield msg.data;
        client.resume();
      }
    }
  }

  return {
    stop: () => {
      client.destroy();
    },
    gen,
  };
}
