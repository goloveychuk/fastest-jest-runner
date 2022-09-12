#include <napi.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>
#include <uv.h>
// #include <iostream>

#include "ev_loop.h"
// #include "childsub_cb.h"
#include "childsub.h"
//
using namespace Napi;

// extern "C" void
// init (Handle<Object> target)
// {
// 	HandleScope scope;

// 	EXPORTS_FN("fork", fork_fn);
// }

Value fork_fn(const CallbackInfo &info)
{
  int id = info[0].As<Number>();
  int closeFd = info[1].As<Number>();
  //   Function callback = info[1].As<Function>();
  //   SimpleAsyncWorker* asyncWorker = new SimpleAsyncWorker(callback, runTime);
  //   asyncWorker->Queue();
  //   std::string msg =
  //       "SimpleAsyncWorker for " + std::to_string(runTime) + " seconds queued.";
  //   return String::New(info.Env(), msg.c_str());

  pid_t pid = fork();

  if (pid < 0)
  {
    throw std::runtime_error("fork failed");
  }

  if (pid == 0)
  { // im children
    close(closeFd);
    int fd0 = open("/dev/null", O_RDONLY);
    int fd1 = open("/dev/null", O_RDWR);
    int fd2 = open("/dev/null", O_RDWR);
    if (fd0 < 0) {
        perror("open failed\n");
        exit(0);
    }
    if (fd1 < 0) {
        perror("open failed\n");
        exit(0);
    }
    if (fd2 < 0) {
        perror("open failed\n");
        exit(0);
    }
    dup2(fd0, 0);
    close(fd0);
    dup2(fd1, 1);
    close(fd1);
    dup2(fd2, 2);
    close(fd2);
    // setsid(); // 30 s faster??
    uv_loop_t *loop;
    if (napi_get_uv_event_loop(info.Env(), &loop))
    {
      throw std::runtime_error("get loop failed");
    };

    // auto loop = uv_default_loop();

    uv_loop_fork(loop);
  }
  else
  {
    // im parent
    write_proc_data(ProcMsgTypes::created, pid, id);
  }

  // if (pid < 0)
  // {
  // 	return ThrowException(Exception::Error(String::New("Unable to fork daemon, pid < 0.")));
  // }

  return Number::New(info.Env(), pid);
};

Value get_my_pid(const CallbackInfo &info)
{
  pid_t my_pid = getpid();

  return Number::New(info.Env(), my_pid);
}

void make_fifo(const CallbackInfo &info)
{
  auto file = info[0].As<String>().Utf8Value();
  auto cstr = file.c_str();
  remove(cstr);
  int res = mkfifo(cstr, 0644);
  if (res)
  {
    fprintf(stderr, "mkfifo failed: %s\n", strerror(res));
    throw std::runtime_error("mkfifo failed");
  }

  return;
}

void wait_for_all_children(const CallbackInfo &info)
{
  pid_t pid;
  int status;
  while ((pid = waitpid(-1, &status, 0)) > 0)
  {
    write_proc_data(ProcMsgTypes::exited, pid, status);
  };
}

void send_this_proc_ok(const CallbackInfo &info)
{
  write_proc_data(ProcMsgTypes::proc_ok, getpid(), 0);
}

void close_fd(const CallbackInfo &info)
{
  int fd = info[0].As<Number>();
  close(fd);
}

Value pipefd(const CallbackInfo &info)
{
  int fd1[2];
  if (pipe(fd1) == -1)
  {
    throw std::runtime_error("pipe failed");
  }
  Object obj = Object::New(info.Env());
  obj.Set("read", fd1[0]);
  obj.Set("write", fd1[1]);
  return obj;
}

void on_read(uv_stream_t *client, ssize_t nread, const uv_buf_t *buf) {
    if (nread < 0) {
        if (nread != UV_EOF)
            fprintf(stderr, "Read error %s\n", uv_err_name(nread));
        uv_close((uv_handle_t *) client, NULL);
        free(buf->base);
        return;
    }

    char *data = (char *) malloc(sizeof(char) * (nread + 1));
    data[nread] = '\0';
    strncpy(data, buf->base, nread);

    fprintf(stdout, "%s", data);
    free(data);
    free(buf->base);
}

void alloc_buffer(uv_handle_t *handle, size_t suggested_size, uv_buf_t *buf) {
    *buf = uv_buf_init((char *) malloc(suggested_size), suggested_size);
}

void sub_pipe(const CallbackInfo &info)
{
  int fd1 = info[0].As<Number>();
  // int fd2 = info[1].As<Number>();
  uv_loop_t *loop;
  if (napi_get_uv_event_loop(info.Env(), &loop))
  {
    throw std::runtime_error("get loop failed");
  };
  uv_pipe_t *pipe = (uv_pipe_t *)malloc(sizeof(uv_pipe_t));

  uv_pipe_init(loop, pipe, true);
  uv_pipe_open(pipe, fd1);
  // uv_pipe_connect()
  int r;
  if ((r = uv_read_start((uv_stream_t *)pipe, alloc_buffer, on_read)))
  {
    fprintf(stderr, "%s\n", uv_strerror(r));
    throw std::runtime_error("uv_read_start failed");
  }
  return;
}

Object Init(Env env, Object exports)
{
  exports["fork"] = Function::New(
      env, fork_fn, std::string("fork_fn"));
  exports["getpid"] = Function::New(
      env, get_my_pid, std::string("get_my_pid"));
  exports["subscribe_child"] = Function::New(
      env, subscribe_child, std::string("subscribe_child"));
  exports["close"] = Function::New(
      env, close_fd, std::string("close"));
  exports["make_fifo"] = Function::New(
      env, make_fifo, std::string("make_fifo"));
  exports["send_this_proc_ok"] = Function::New(
      env, send_this_proc_ok, std::string("send_this_proc_ok"));
  exports["wait_for_all_children"] = Function::New(
      env, wait_for_all_children, std::string("wait_for_all_children"));
  exports["pipe"] = Function::New(
      env, pipefd, std::string("pipe"));

  exports["sub_pipe"] = Function::New(
      env, sub_pipe, std::string("sub_pipe"));
  return exports;
}

NODE_API_MODULE(addon, Init)