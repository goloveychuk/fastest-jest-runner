import { ChildProcess, Serializable } from 'child_process';
import { EventEmitter } from 'stream';


export type ProcessLike = EventEmitter & { send: ChildProcess['send'] }

export function wrapChild<I extends Serializable, O>(
  child: ProcessLike,
  cb: (data: O) => void,
) {
  child.on('message', (data) => {
    cb(data as O);
  });

  return {
    send: (input: I) => {
      return new Promise<void>((resolve, reject) => {
        child.send(input, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
  };
}
