#include <napi.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <stdexcept>
#include <unistd.h>

// #include "ev_loop.h"

using namespace Napi;

int fd;

bool sub_called = false;

const int SIZE = 3;

const int SIZE_BYTES = sizeof(int) * SIZE;

enum ProcMsgTypes {
  created,
  exited,
  proc_ok,
};

int write_proc_data(int arg1, int arg2, int arg3)
{
  int data[SIZE] = {arg1, arg2, arg3};
  for (int i = 0; i < SIZE; i++)
  {
    data[i] = htonl(data[i]);
  }
  int written = write(fd, data, SIZE_BYTES);
  if (written<0) {
    throw std::runtime_error("write to fifo failed");
  }
  return written;
}

void child_handler(int sign)
{

  pid_t pid;
  int status;

  // fprintf(stderr, "Inside zombie deleter:  \n");
  while ((pid = waitpid(-1, &status, WNOHANG)) > 0)
  {
    // fprintf(stderr, "before write: %d \n", pid);
    write_proc_data(ProcMsgTypes::exited, pid, status);
    // data.type = htonl(1); //big endian
    // data.pid = htonl(pid);
    // data.status = htonl(status);

    // fprintf(stderr, "written data %d, fd %d\n", written, fd);
  }

  // write(fd, "child_handler", 13);
}

void subscribe_child(const CallbackInfo &info)
{
  if (sub_called) {
    throw std::runtime_error("subscribe_child can only be called once");
  }
  sub_called = true;
  
  auto file = info[0].As<String>().Utf8Value();

  auto cstr = file.c_str();
  // auto cstr= "/tmp/jj/proc_control";

  fd = open(cstr, O_WRONLY | O_APPEND);
  if (fd < 0)
  {
    throw std::runtime_error("Can't open fifo file");
  }
  
  // close(fd);

  struct sigaction sa;

  sigemptyset(&sa.sa_mask);
  sa.sa_flags = SA_RESTART;
  // memset(&sa,0,sizeof(sa));
  sa.sa_handler = child_handler;

  if (sigaction(SIGCHLD, &sa, NULL)) {
    throw std::runtime_error("sigaction failed");
  };

  return;
}
