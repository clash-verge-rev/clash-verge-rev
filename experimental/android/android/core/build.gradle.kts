// First mobile build uses exact official v2.11.35 arm64 JNI libraries.
// See UPSTREAM.md for source, hashes and the source-build alternative.
plugins {
    kotlin("android")
    id("com.android.library")
    id("kotlinx-serialization")
}

dependencies {
    implementation(project(":common"))
    implementation(libs.androidx.core)
    implementation(libs.kotlin.coroutine)
    implementation(libs.kotlin.serialization.json)
}
