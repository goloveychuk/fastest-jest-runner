import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { ProcessLike } from './wrapChild';

const bindings = require('../build/Release/addon');
// const inspector = require('inspector') as typeof import('inspector');

const { internalBinding } = require('internal/test/binding');
const { Pipe , constants: PipeConstants} = internalBinding('pipe_wrap');
const {setupChannel} = require('internal/child_process');


export class ForkedProcess extends EventEmitter implements ProcessLike {
    constructor(public isChild: boolean){
        super()
    }
    send!: ChildProcess['send']
}



function openConnection(obj: any, fd: number) {
    const p = new Pipe(PipeConstants.IPC);
    p.open(fd);
    p.unref();
    const control = setupChannel(obj, p, 'json');
    obj.on('newListener', function onNewListener(name: string) {
      if (name === 'message' || name === 'disconnect') control.refCounted();
    });
    obj.on('removeListener', function onRemoveListener(name: string) {
      if (name === 'message' || name === 'disconnect') control.unrefCounted();
    });
}

function fork(): ForkedProcess {
        // inspector.close()
    const [readFd, writeFd] = bindings.make_socket_pair()
    const pid = bindings.fork();
    if(pid === 0) { //child
        const forkedProcess = new ForkedProcess(true)
        openConnection(forkedProcess, readFd)
        const mypid = bindings.getpid(); //set also parent pid??
        Object.defineProperty(process, 'pid', {value: mypid})
        if (process.pid !== mypid) {
            throw new Error('pid not set');
        }
        return forkedProcess
    } else { //parent
        const forkedProcess = new ForkedProcess(false)
        openConnection(forkedProcess, writeFd)
        return forkedProcess
    }
    // inspector.open(0, undefined, false)
}


// function getpid(): number {
//     return bindings.getpid();
// }



function waitForAllChildren(){ 
    bindings.wait_for_all_children()
}

export {fork, waitForAllChildren}