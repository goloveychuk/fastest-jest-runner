import * as fs from 'fs';
import type {FileHandle} from 'fs/promises';
import type {Fifo} from './fifo-maker';

enum ProcMsgTypes {
  created,
  exited,
  proc_ok,
}

const INT_SIZE = 4;

type Payload =
  | [type: ProcMsgTypes.created, pid: number, id: number]
  | [type: ProcMsgTypes.proc_ok, pid: number, _empty: 0]
  | [type: ProcMsgTypes.exited, pid: number, status: number];

const NUMS: Payload['length'] = 3;

export type OnProcExit = (data: {
  id: number;
  pid: number;
  status: number;
}) => void;

interface Data {
  id: number;
  receivedOk: boolean;
}
class ProcControl {
  private procMapping = new Map<number, Data>(); //key is pid

  constructor(private fifo: Fifo, private onProcExit: OnProcExit) {}
  fd!: FileHandle;
  // async init() {
  // }

  async loop() {
    this.fd = await fs.promises.open(this.fifo.path, 'r');
    while (true) {
      const buf = Buffer.alloc(NUMS * INT_SIZE);

      const {bytesRead} = await this.fd.read(buf, 0, buf.byteLength, null);
      if (bytesRead === 0) {
        // pipe was closed
        break;
      }

      const data = new Array(NUMS)
        .fill(0)
        .map((_, i) => buf.readInt32BE(i * INT_SIZE));

      this.process(data as Payload);
    }
  }
  getLeftProcesses() {
    return [...this.procMapping.entries()];
  }
  private process(payload: Payload) {
    // console.log(payload);
    switch (payload[0]) {
      case ProcMsgTypes.created: {
        const pid = payload[1];
        const id = payload[2];

        this.procMapping.set(pid, {id, receivedOk: false});
        break;
      }
      case ProcMsgTypes.proc_ok: {
        const pid = payload[1];
        const data = this.procMapping.get(pid) ;
        if (!data) {
          throw new Error('No such pid '+pid);
        }
        data.receivedOk = true;
        break;
      }
      case ProcMsgTypes.exited: {
        const pid = payload[1];
        const status = payload[2];
        const data = this.procMapping.get(pid);
        if (data === undefined) {
          throw new Error('exited pid not found');
        }
        this.procMapping.delete(pid);
        if (!data.receivedOk) {
          this.onProcExit({id: data.id, pid, status});
        }
      }
    }
  }
}

export {ProcControl};
