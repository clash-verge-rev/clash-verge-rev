#include "trace.h"

#if ENABLE_TRACE

void trace_method_exit(const char **name) {
    __android_log_print(ANDROID_LOG_VERBOSE, TAG, "TRACE-OUT %s", *name);
}

#endif