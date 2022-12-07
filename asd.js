const net = require('net');
const fs = require('fs');
const cp = require('child_process');
const fork = require('./runner/build/Release/addon');
const fd = fs.openSync('/tmp/node.test.sock', 'w+');
const events = require('events');
const console = require('console');
const { internalBinding } = require('internal/test/binding');
const { Pipe, constants: PipeConstants } = internalBinding('pipe_wrap');
const {setupChannel} = require('internal/child_process');

// require('pipe_wrap')
// net.SocketAddress
// net.createConnection

// const p = cp.fork('./test.js')
// const fd = p._channel.fd
const [readFd, writeFd] = fork.make_fifo();


function withProcess(pr, cb) {
    const origProcess = globalThis.process;
    // Object.defineProperty(globalThis, 'process', {value: pr})
    globalThis.process = pr
    // global.process = pr;
    // try {
        cb()
    // } finally {
        // globalThis.process = origProcess
    // }

}
const pid = fork.fork(1);
if (pid === 0) {
  //children
  require('child_process')._forkChild(readFd, 'json');
  process.on('message', (d) => {
    console.log({ d });
    process.send({resp: 'asd'})
    // process.exit(0)
  });
} else {
    const obj = new events.EventEmitter();
    // withProcess(obj, () => {
        // console.log(process)
    // with ({asd: obj}) {
        // console.log(require)
        // require('./test.js')
        // require('child_process')._forkChild(writeFd, 'json');
    // })
    // })
    // console.log(obj.listeners('newListener'))
    // obj.send({data: 'asd'})

//   const sock = new net.Socket({ fd: writeFd });
    const p = new Pipe(PipeConstants.IPC);
  p.open(writeFd);
  p.unref();

  const control = setupChannel(obj, p, 'json');
  obj.on('newListener', function onNewListener(name) {
    if (name === 'message' || name === 'disconnect') control.refCounted();
  });

//   sock.write(JSON.stringify({ data: 'asd' }) + '\n');
obj.send({data: 'asd2'})
//   sock.on('data', x=>console.log(x.toString()))
}

console.log('here');

// console.log(sock)
