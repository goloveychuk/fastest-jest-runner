#include <napi.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <stdexcept>
#include <unistd.h>
#include "uv.h"
// #include "ev_loop.h"
using namespace Napi;





void subscribe_child(const CallbackInfo& info);