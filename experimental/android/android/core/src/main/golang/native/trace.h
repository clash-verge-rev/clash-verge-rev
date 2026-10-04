#pragma once

#include "bridge.h"

#include <android/log.h>

#define ENABLE_TRACE 0

#if ENABLE_TRACE

extern void trace_method_exit(const char **name);

#define TRACE_METHOD() __attribute__((cleanup(trace_method_exit))) const char *__method_name = __FUNCTION__; __android_log_print(ANDROID_LOG_VERBOSE, TAG, "TRACE-IN  %s", __method_name)

#else

#define TRACE_METHOD()

#endif