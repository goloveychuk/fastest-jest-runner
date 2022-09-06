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
    // setsid(); 30 s faster??
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

Object Init(Env env, Object exports)
{
  exports["fork"] = Function::New(
      env, fork_fn, std::string("fork_fn"));
  exports["getpid"] = Function::New(
      env, get_my_pid, std::string("get_my_pid"));
  exports["subscribe_child"] = Function::New(
      env, subscribe_child, std::string("subscribe_child"));
  exports["make_fifo"] = Function::New(
      env, make_fifo, std::string("make_fifo"));
  exports["send_this_proc_ok"] = Function::New(
      env, send_this_proc_ok, std::string("send_this_proc_ok"));
  exports["wait_for_all_children"] = Function::New(
      env, wait_for_all_children, std::string("wait_for_all_children"));
  return exports;
}

NODE_API_MODULE(addon, Init)