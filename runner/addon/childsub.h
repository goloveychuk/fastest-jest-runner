#include <napi.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <stdexcept>
#include <unistd.h>
#include "childsub.cc"
// #include "ev_loop.h"
using namespace Napi;




void subscribe_child(const CallbackInfo& info);

int write_proc_data(int arg1, int arg2, int arg3, int arg4);