#include <napi.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <stdexcept>
#include <unistd.h>
#include "uv.h"
// #include "ev_loop.h"

using namespace Napi;

Napi::ThreadSafeFunction jsHandle;

void signal_handler(uv_signal_t *handle, int signum)
{
  // uv_signal_stop(handle);
  pid_t pid;
  int status;

  auto callback = [](Napi::Env env, Napi::Function jsCallback, int *data)
  {
    jsCallback.Call({Napi::Number::New(env, *data)});
    free(data);
  };

  printf("Inside zombie deleter:  ");

  //  auto env = jsHandle.Env();
  //  auto that = Object::New(env);

  while ((pid = waitpid(-1, &status, WNOHANG)) > 0)
  {
    int *pid_ref = (int *)malloc(sizeof(int));
    *pid_ref = pid;
    fprintf(stderr, "Child %d terminated\n", pid);
    jsHandle.NonBlockingCall(pid_ref, callback);
    //  void * data = (*handle).data;
    //   FunctionReference casted = (FunctionReference*)data;
    // jsHandle.MakeCallback(that, 0, {});
    //  (FunctionReference)data.Call({});
  }
  // fprintf( stderr, "Child terminated!!!!!!!!!!!!!!!!!!!!!!!! from c++");
  // auto a = 1 / 0;
  // printf("%d", a);
  // (*jsHandler).Call({});

  // {
  // Function fn = *((Function*)handle->data);

  // fn.Call({});
  //     // printf("Signal received: %d\n", signum);
  //     // uv_signal_stop(handle);
}

Value subscribe_child(const CallbackInfo &info)
{
  //   // using namespace std::placeholders;
  Function callback = info[0].As<Function>();

  uv_loop_t *loop;
  if (napi_get_uv_event_loop(info.Env(), &loop))
  {
    throw std::runtime_error("get loop failed");
  };

  // auto loop = uv_default_loop();
  // uv_loop_t loop;
  //   // loop.data = callback;
  // uv_loop_init(&loop);

  uv_signal_t *child_exit = (uv_signal_t *)malloc(sizeof(uv_signal_t));

  // jsHandle = Persistent(callback);
  jsHandle =
      Napi::ThreadSafeFunction::New(info.Env(), // Environment
                                    callback,   // JS function from caller
                                    "TSFN",     // Resource name
                                    0,          // Max queue size (0 = unlimited).
                                    1           // Initial thread count
                                                // nullptr, // Context,
                                                // nullptr, // Finalizer
                                                // (void *)nullptr    // Finalizer data
      );

  if (uv_signal_init(loop, child_exit))
  {
    throw std::runtime_error("not inited");
  }

  if (uv_signal_start(child_exit, signal_handler, SIGCHLD))
  {
    throw std::runtime_error("uv_signal_start failed");
  };
  // uv_signal_stop(&child_exit);

  // uv_unref()
  // uv_run(loop, UV_RUN_DEFAULT);

  return Boolean::New(info.Env(), true);
}