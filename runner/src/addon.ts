const bindings = require('../build/Release/addon');
const inspector = require('inspector') as typeof import('inspector');

function fork(id: number): number {
        // inspector.close()
    const pid = bindings.fork(id);
    if(pid === 0) { //children
        // inspector.close()
        // inspector.Session
        // const sess = new inspector.Session()
        // sess.connect()
        const mypid = bindings.getpid(); //set also parent pid??
        Object.defineProperty(process, 'pid', {value: mypid})
        if (process.pid !== mypid) {
            throw new Error('pid not set');
        }
    }
    // inspector.open(0, undefined, false)
    return pid 
}


// function getpid(): number {
//     return bindings.getpid();
// }

function make_fifo(path: string) {
    bindings.make_fifo(path)
}

function startProcControl(path: string) {
    bindings.subscribe_child(path)
}

function sendThisProcOk() {
    bindings.send_this_proc_ok()
}

function waitForAllChildren(){ 
    bindings.wait_for_all_children()
}

export {fork, startProcControl, make_fifo, sendThisProcOk, waitForAllChildren}