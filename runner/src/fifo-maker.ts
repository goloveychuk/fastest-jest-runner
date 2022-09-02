import * as path from 'path';
import * as addon from './addon';

export interface Fifo {
  path: string;
  id: number;
}

export class FifoMaker {
  private curId = 0;
  private allFifos: Map<number, Fifo> = new Map();

  constructor(private baseDir: string) {}

  getFifoById(id: number) {
    const res = this.allFifos.get(id);
    if (!res) {
        throw new Error('no fifo with id: ' + id);
    }
    return res
  }

  makeFifo(desc: string): Fifo {
    const id = this.curId++;
    const p = path.join(this.baseDir, `pipe_${desc}_${id}`);
    addon.make_fifo(p);
    const fifo: Fifo  = {path: p, id}; 
    this.allFifos.set(id, fifo)
    return fifo
  }
}
