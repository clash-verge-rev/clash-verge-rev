// SPDX-License-Identifier: GPL-3.0-only
// Uses the pinned CMFA libclash export. Unlike its legacy JNI shim, preserves
// the real tun.Start result. The Go side owns and releases callback after call.
#include "jni.h"

extern int startTun(int fd, const char *stack, const char *gateway,
                    const char *portal, const char *dns, void *callback);

JNIEXPORT jint JNICALL
Java_com_github_kr328_clash_core_bridge_CheckedTun_start(
    JNIEnv *env, jobject self, jint fd, jstring stack, jstring gateway,
    jstring portal, jstring dns, jobject callback) {
    const char *s = (*env)->GetStringUTFChars(env, stack, 0);
    if (!s) return 1;
    const char *g = (*env)->GetStringUTFChars(env, gateway, 0);
    if (!g) { (*env)->ReleaseStringUTFChars(env, stack, s); return 1; }
    const char *p = (*env)->GetStringUTFChars(env, portal, 0);
    if (!p) { (*env)->ReleaseStringUTFChars(env, gateway, g);
        (*env)->ReleaseStringUTFChars(env, stack, s); return 1; }
    const char *d = (*env)->GetStringUTFChars(env, dns, 0);
    if (!d) { (*env)->ReleaseStringUTFChars(env, portal, p);
        (*env)->ReleaseStringUTFChars(env, gateway, g);
        (*env)->ReleaseStringUTFChars(env, stack, s); return 1; }
    jobject owned = (*env)->NewGlobalRef(env, callback);
    int result = owned ? startTun(fd, s, g, p, d, owned) : 1;
    // startTun's error path calls remote.close, which releases owned exactly once.
    (*env)->ReleaseStringUTFChars(env, dns, d);
    (*env)->ReleaseStringUTFChars(env, portal, p);
    (*env)->ReleaseStringUTFChars(env, gateway, g);
    (*env)->ReleaseStringUTFChars(env, stack, s);
    return result;
}
