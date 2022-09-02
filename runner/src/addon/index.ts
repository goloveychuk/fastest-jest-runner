const bindings = require('../../build/Release/addon');

function fork(id: number): number {
    const pid = bindings.fork(id);
    
    return pid 
}


function getpid(): number {
    return bindings.getpid();
}

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

export {getpid, fork, startProcControl, make_fifo, sendThisProcOk, waitForAllChildren}