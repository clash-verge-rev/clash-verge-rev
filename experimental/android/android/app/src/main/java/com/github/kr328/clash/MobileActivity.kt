package com.github.kr328.clash

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.Keep
import androidx.core.content.ContextCompat
import com.github.kr328.clash.common.Global
import com.github.kr328.clash.common.constants.Authorities
import com.github.kr328.clash.core.Clash
import com.github.kr328.clash.core.bridge.Bridge
import com.github.kr328.clash.core.bridge.CheckedTun
import com.github.kr328.clash.core.model.LogMessage
import com.github.kr328.clash.core.model.ProxySort
import com.github.kr328.clash.core.model.TunnelState
import com.github.kr328.clash.design.MainDesign
import com.github.kr328.clash.service.StatusProvider
import com.github.kr328.clash.service.model.Profile
import com.github.kr328.clash.service.remote.ILogObserver
import com.github.kr328.clash.service.util.pendingDir
import com.github.kr328.clash.util.startClashService
import com.github.kr328.clash.util.stopClashService
import com.github.kr328.clash.util.withClash
import com.github.kr328.clash.util.withProfile
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.URI
import java.util.Date
import java.util.UUID

/** Independent GPL mobile host. All engine operations use CMFA's real Binder service. */
class MobileActivity : BaseActivity<MainDesign>() {
    private lateinit var web: WebView
    private val mutations = Mutex()
    private var pageReady = false
    private var connecting = false
    private var lastError: String? = null
    private val recentLogs = ArrayDeque<JSONObject>()
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* VPN permission and core readiness remain independent. */ }
    private val logObserver = object : ILogObserver {
        override fun newItem(log: LogMessage) {
            synchronized(recentLogs) {
                recentLogs.addLast(JSONObject().put("time", iso(log.time))
                    .put("level", log.level.name.lowercase()).put("message", redact(log.message)))
                while (recentLogs.size > 200) recentLogs.removeFirst()
            }
        }
    }

    override suspend fun main() {
        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web.addJavascriptInterface(NativeBridge(), "VergeNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !allowed(request.url)
            @Suppress("DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                !allowed(Uri.parse(url))
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                val uri = request.url
                if (!allowed(uri) || request.method != "GET") return rejected()
                val relative = uri.path!!.removePrefix("/assets/")
                if (relative.contains("..") || relative.contains('\\') || !relative.startsWith("web/")) return rejected()
                return try {
                    val mime = when {
                        relative.endsWith(".html") -> "text/html"
                        relative.endsWith(".js") -> "application/javascript"
                        relative.endsWith(".css") -> "text/css"
                        relative.endsWith(".json") -> "application/json"
                        relative.endsWith(".svg") -> "image/svg+xml"
                        relative.endsWith(".png") -> "image/png"
                        relative.endsWith(".woff2") -> "font/woff2"
                        else -> "application/octet-stream"
                    }
                    val bytes = assets.open(relative).use { it.readBytes() }
                    val scriptHashes = if (relative.endsWith(".html")) Regex("(?s)<script[^>]*>(.*?)</script>").findAll(bytes.toString(Charsets.UTF_8)).map {
                        "'sha256-" + android.util.Base64.encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(it.groupValues[1].toByteArray(Charsets.UTF_8)), android.util.Base64.NO_WRAP) + "'"
                    }.joinToString(" ") else ""
                    WebResourceResponse(mime, "UTF-8", 200, "OK", mapOf(
                        "Content-Security-Policy" to "default-src 'self'; script-src 'self' $scriptHashes; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'",
                        "X-Content-Type-Options" to "nosniff",
                        "Cache-Control" to "no-store"
                    ), ByteArrayInputStream(bytes))
                } catch (_: Exception) { rejected() }
            }
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) { pageReady = allowed(Uri.parse(url)) }
            override fun onPageFinished(view: WebView, url: String) { pageReady = allowed(Uri.parse(url)) }
        }
        setContentView(web)
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this,
                Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        web.loadUrl(HOME)
        while (isActive) {
            when (events.receive()) {
                Event.ActivityStart, Event.ServiceRecreated -> attachLogs()
                else -> Unit
            }
        }
    }

    private fun allowed(uri: Uri): Boolean = uri.scheme == "https" &&
        uri.host == "appassets.androidplatform.net" && uri.port == -1 &&
        uri.path?.startsWith("/assets/web/") == true
    private fun rejected() = WebResourceResponse("text/plain", "UTF-8", 403,
        "Forbidden", emptyMap(), ByteArrayInputStream("Blocked resource".toByteArray()))

    @Keep
    inner class NativeBridge {
        @JavascriptInterface
        fun request(payload: String) {
            if (payload.length > 2_000_000) return
            launch {
                if (!pageReady || !allowed(Uri.parse(web.url ?: ""))) return@launch
                var id = ""
                try {
                    val request = JSONObject(payload)
                    id = request.getString("id")
                    require(id.isNotEmpty() && id.length <= 128) { "Invalid request ID" }
                    val method = request.getString("method")
                    val params = request.optJSONObject("params") ?: JSONObject()
                    val result = if (method in READ_ONLY) withTimeout(15_000) { dispatch(method, params) }
                        else withTimeout(90_000) { mutations.withLock { dispatch(method, params) } }
                    reply(JSONObject().put("id", id).put("result", result ?: JSONObject.NULL))
                } catch (e: CancellationException) {
                    if (e is TimeoutCancellationException) reply(JSONObject().put("id", id)
                        .put("error", "Native operation timed out; refresh status before retrying."))
                    else throw e
                } catch (e: Throwable) {
                    if (id.isNotEmpty()) reply(JSONObject().put("id", id).put("error", redact(e.message ?: "Native operation failed")))
                }
            }
        }
    }

    private fun reply(payload: JSONObject) {
        if (!isDestroyed && pageReady) {
            // JSONObject serialization escapes quotes, line terminators and arbitrary profile text.
            web.evaluateJavascript("window.__vergeReceive && window.__vergeReceive(${payload});", null)
        }
    }

    private suspend fun dispatch(method: String, params: JSONObject): Any? = when (method) {
        "status" -> status()
        "profiles.list" -> JSONArray(withProfile { queryAll() }.filter { it.imported }.map(::profileJson))
        "profiles.import" -> importProfile(params)
        "profiles.activate" -> {
            val profile = requireProfile(params)
            val wasRunning = loadedUUID() != null
            val previousGeneration = loadedGeneration()
            withProfile { setActive(profile) }
            check(withProfile { queryActive()?.uuid } == profile.uuid) { "Active profile was not saved" }
            if (wasRunning) waitLoaded(profile.uuid, previousGeneration)
            null
        }
        "profiles.update" -> {
            val profile = requireProfile(params)
            require(profile.type == Profile.Type.Url) { "Only HTTPS subscriptions can update" }
            requireHttps(profile.source)
            val previousGeneration = loadedGeneration()
            // Commit awaits actual native download + validation; scheduling update() alone does not.
            withProfile {
                patch(profile.uuid, profile.name, profile.source, profile.interval, profile.ageSecretKey)
                try { commit(profile.uuid) } catch (e: Exception) { release(profile.uuid); throw e }
            }
            if (loadedUUID() != null && profile.active) waitLoaded(profile.uuid, previousGeneration)
            null
        }
        "vpn.start" -> { startVpn(); null }
        "vpn.stop" -> {
            stopClashService()
            waitStopped()
            connecting = false
            lastError = null
            null
        }
        "proxies.list" -> proxies()
        "proxies.select" -> {
            require(vpnRunning()) { "Start VPN before choosing a proxy" }
            val groupName = requiredText(params, "group", 1024)
            val node = requiredText(params, "name", 1024)
            withClash {
                require(queryProxyGroupNames(false).contains(groupName)) { "Unknown proxy group" }
                val group = queryProxyGroup(groupName, ProxySort.Default)
                require(group.type.equals("Selector", true)) { "This group is selected automatically" }
                require(group.proxies.any { it.name == node }) { "Unknown proxy in group" }
                check(patchSelector(groupName, node)) { "Core rejected proxy selection" }
                check(queryProxyGroup(groupName, ProxySort.Default).now == node) { "Proxy selection not applied" }
            }
            null
        }
        "proxies.delay" -> throw UnsupportedOperationException("Individual proxy latency is unavailable through the bundled CMFA bridge. Use native settings for group health checks.")
        "settings.mode" -> {
            require(vpnRunning()) { "Start VPN before changing mode" }
            val mode = when (params.getString("mode")) {
                "rule" -> TunnelState.Mode.Rule
                "global" -> TunnelState.Mode.Global
                "direct" -> TunnelState.Mode.Direct
                else -> throw IllegalArgumentException("Invalid mode")
            }
            withClash { patchOverride(Clash.OverrideSlot.Persist,
                queryOverride(Clash.OverrideSlot.Persist).apply { this.mode = mode }) }
            withTimeout(15_000) {
                while (withClash { queryTunnelState().mode } != mode) {
                    check(lastError == null) { lastError ?: "Core stopped" }; delay(150)
                }
            }
            null
        }
        "logs.list" -> synchronized(recentLogs) { JSONArray(recentLogs.toList()) }
        "native.settings" -> { startActivity(Intent(this, SettingsActivity::class.java)); null }
        "native.home" -> { startActivity(Intent(this, MainActivity::class.java)); null }
        else -> throw IllegalArgumentException("Unknown native method")
    }

    private suspend fun status(): JSONObject {
        val result = JSONObject().put("platform", "android").put("canTestDelay", false).put("canChooseFile", false)
        var ready = false
        try {
            val state = withClash { queryTunnelState() }
            val version = withContext(Dispatchers.IO) {
                Bridge.nativeCoreVersion().also { CheckedTun.ensureLoaded() }
            }
            ready = version.isNotBlank()
            result.put("coreVersion", version).put("mode", state.mode.name.lowercase())
        } catch (e: Throwable) {
            if (e is CancellationException) throw e
            result.put("lastError", redact(e.message ?: "Core unavailable"))
        }
        val active = withProfile { queryActive() }
        if (active != null) result.put("activeProfileId", active.uuid.toString())
        val native = serviceStatus()
        val running = vpnRunning(native)
        val state = when {
            connecting -> "connecting"
            running -> "running"
            native.getBoolean("vpnServiceRunning") && lastError == null -> "connecting"
            lastError != null -> "error"
            else -> "stopped"
        }
        result.put("vpn", state).put("coreReady", ready)
        lastError?.let { result.put("lastError", it) }
        return result
    }

    private suspend fun importProfile(params: JSONObject): JSONObject {
        val name = requiredText(params, "name", 256)
        val url = params.optString("url").takeIf { it.isNotBlank() }
        val content = params.optString("content").takeIf { it.isNotBlank() }
        require((url == null) != (content == null)) { "Supply HTTPS URL or YAML content" }
        if (url != null) requireHttps(url)
        if (content != null) require(content.length <= 1_000_000) { "YAML is too large" }
        val uuid = withProfile { create(if (url != null) Profile.Type.Url else Profile.Type.File,
            name, url ?: "") }
        try {
            if (content != null) withContext(Dispatchers.IO) {
                pendingDir.resolve(uuid.toString()).resolve("config.yaml").writeText(content, Charsets.UTF_8)
            }
            withProfile { commit(uuid) }
            val imported = withProfile { queryByUUID(uuid) }
            check(imported != null && imported.imported) { "Native profile validation failed" }
            return profileJson(imported)
        } catch (e: Throwable) {
            withContext(NonCancellable) { withProfile { release(uuid) } }
            throw e
        }
    }

    private suspend fun requireProfile(params: JSONObject): Profile {
        val uuid = UUID.fromString(requiredText(params, "id", 36))
        return withProfile { queryByUUID(uuid) }?.takeIf { it.imported }
            ?: throw IllegalArgumentException("Profile not found")
    }
    private fun requireHttps(source: String) {
        require(source.length <= 16_384) { "Subscription URL is too long" }
        val uri = URI(source)
        require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawUserInfo == null &&
            uri.fragment == null) { "A valid HTTPS subscription URL is required" }
    }
    private fun requiredText(params: JSONObject, key: String, max: Int): String =
        params.getString(key).also { require(it.isNotBlank() && it.length <= max) { "Invalid $key" } }
    private fun profileJson(profile: Profile): JSONObject = JSONObject()
        .put("id", profile.uuid.toString()).put("name", profile.name).put("active", profile.active)
        .put("updatedAt", iso(Date(profile.updatedAt))).apply {
            if (profile.type == Profile.Type.Url) put("sourceHost", runCatching { URI(profile.source).host }.getOrNull())
        }

    private suspend fun proxies(): JSONArray {
        require(vpnRunning()) { "Start VPN to load proxy groups" }
        return withClash {
            JSONArray(queryProxyGroupNames(false).map { name ->
                val group = queryProxyGroup(name, ProxySort.Default)
                JSONObject().put("name", name).put("type", group.type).put("now", group.now)
                    .put("all", JSONArray(group.proxies.map { proxy ->
                        JSONObject().put("name", proxy.name).put("type", proxy.type).apply {
                            if (proxy.delay > 0) put("delay", proxy.delay)
                        }
                    }))
            })
        }
    }

    private fun serviceStatus(): android.os.Bundle = contentResolver.call(
        Uri.Builder().scheme("content").authority(Authorities.STATUS_PROVIDER).build(),
        StatusProvider.METHOD_CURRENT_PROFILE, null, null) ?: android.os.Bundle()

    private fun loadedUUID(): String? = serviceStatus().getString("uuid")

    private fun vpnRunning(state: android.os.Bundle = serviceStatus()): Boolean =
        state.getBoolean("serviceRunning") && state.getBoolean("vpnServiceRunning") &&
        state.getBoolean("tunReady") && state.getString("uuid") != null

    private fun loadedGeneration(): Long = contentResolver.call(
        Uri.Builder().scheme("content").authority(Authorities.STATUS_PROVIDER).build(),
        StatusProvider.METHOD_CURRENT_PROFILE, null, null)?.getLong("generation", 0) ?: 0

    private suspend fun waitLoaded(uuid: UUID, afterGeneration: Long? = null, requireVpn: Boolean = false) {
        withTimeout(25_000) {
            while (loadedUUID() != uuid.toString() || (afterGeneration != null && loadedGeneration() <= afterGeneration) ||
                (requireVpn && !vpnRunning())) {
                check(lastError == null) { lastError ?: "Core stopped" }
                delay(150)
            }
        }
    }

    private suspend fun waitStopped() {
        withTimeout(15_000) { while (serviceStatus().getBoolean("serviceRunning")) delay(150) }
    }

    private suspend fun startVpn() {
        val active = withProfile { queryActive() }
        require(active != null && active.imported) { "Import and activate a profile first" }
        check(status().getBoolean("coreReady")) { "Mihomo native core is unavailable" }
        connecting = true
        lastError = null
        uiStore.enableVpn = true
        try {
            // Native settings can run a proxy-only service; restart it in VPN mode.
            if (serviceStatus().getBoolean("serviceRunning") && !serviceStatus().getBoolean("vpnServiceRunning")) {
                stopClashService()
                waitStopped()
            }
            val request = startClashService()
            if (request != null) {
                val result = startActivityForResult(ActivityResultContracts.StartActivityForResult(), request)
                check(result.resultCode == RESULT_OK) { "VPN permission was denied" }
                check(startClashService() == null) { "VPN permission was not granted" }
            }
            waitLoaded(active.uuid, requireVpn = true)
        } catch (e: Throwable) {
            stopClashService()
            lastError = redact(e.message ?: "VPN failed to start")
            throw e
        } finally { connecting = false }
    }

    private suspend fun attachLogs() {
        try { withTimeout(5_000) { withClash { setLogObserver(logObserver) } } }
        catch (e: CancellationException) { if (e !is TimeoutCancellationException) throw e }
        catch (_: Exception) { /* Status provides an explicit engine error. */ }
    }
    override fun onStopped(cause: String?) {
        if (cause != null) lastError = redact(cause)
        super.onStopped(cause)
    }
    override fun onDestroy() {
        pageReady = false
        if (::web.isInitialized) {
            web.removeJavascriptInterface("VergeNative")
            web.stopLoading()
            web.destroy()
        }
        Global.launch(Dispatchers.IO) { withTimeoutOrNull(2_000) { withClash { setLogObserver(null) } } }
        super.onDestroy()
    }
    companion object {
        private const val HOME = "https://appassets.androidplatform.net/assets/web/index.html"
        private val READ_ONLY = setOf("status", "profiles.list", "proxies.list", "logs.list")
        private fun iso(date: Date): String = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
        }.format(date)
        private fun redact(text: String): String = text
            .replace(Regex("(?i)(authorization\\s*[:=]\\s*)(?:Bearer\\s+|Basic\\s+)?[^\\r\\n,;]+"), "$1<redacted>")
            .replace(Regex("(?i)(?:https?|ssr?|vmess|vless|trojan|hysteria2?|hy2|tuic|socks5?)://[^\\s\\\"'<>]+"), "<redacted-url>")
            .replace(Regex("(?i)([\\\"']?(?:password|secret|token|authorization|api[-_]key)[\\\"']?\\s*[:=]\\s*)(?:\\\"[^\\\"]*\\\"|'[^']*'|[^\\s,;}]+)"), "$1<redacted>")
            .take(4096)
    }
}
