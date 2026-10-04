package com.github.kr328.clash.design

import android.content.Context
import android.view.View
import com.github.kr328.clash.core.model.FetchStatus
import com.github.kr328.clash.design.databinding.DesignPropertiesBinding
import com.github.kr328.clash.design.dialog.ModelProgressBarConfigure
import com.github.kr328.clash.design.dialog.requestModelTextInput
import com.github.kr328.clash.design.dialog.withModelProgressBar
import com.github.kr328.clash.design.util.*
import com.github.kr328.clash.service.model.Profile
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

class PropertiesDesign(context: Context) : Design<PropertiesDesign.Request>(context) {
    sealed class Request {
        object Commit : Request()
        object BrowseFiles : Request()
    }

    private val binding = DesignPropertiesBinding
        .inflate(context.layoutInflater, context.root, false)

    override val root: View
        get() = binding.root

    var profile: Profile
        get() = binding.profile!!
        set(value) {
            binding.profile = value
        }

    val progressing: Boolean
        get() = binding.processing

    suspend fun withProcessing(executeTask: suspend (suspend (FetchStatus) -> Unit) -> Unit) {
        try {
            binding.processing = true

            context.withModelProgressBar {
                configure {
                    isIndeterminate = true
                    text = context.getString(R.string.initializing)
                }

                executeTask {
                    configure {
                        applyFrom(it)
                    }
                }
            }
        } finally {
            binding.processing = false
        }
    }

    suspend fun requestExitWithoutSaving(): Boolean {
        return withContext(Dispatchers.Main) {
            suspendCancellableCoroutine { ctx ->
                val dialog = MaterialAlertDialogBuilder(context)
                    .setTitle(R.string.exit_without_save)
                    .setMessage(R.string.exit_without_save_warning)
                    .setCancelable(true)
                    .setPositiveButton(R.string.ok) { _, _ -> ctx.resume(true) }
                    .setNegativeButton(R.string.cancel) { _, _ -> }
                    .setOnDismissListener { if (!ctx.isCompleted) ctx.resume(false) }
                    .show()

                ctx.invokeOnCancellation { dialog.dismiss() }
            }
        }
    }

    init {
        binding.self = this

        binding.activityBarLayout.applyFrom(context)

        binding.tips.text = context.getHtml(R.string.tips_properties)

        binding.scrollRoot.bindAppBarElevation(binding.activityBarLayout)
    }

    fun inputName() {
        launch {
            val name = context.requestModelTextInput(
                initial = profile.name,
                title = context.getText(R.string.name),
                hint = context.getText(R.string.properties),
                error = context.getText(R.string.should_not_be_blank),
                validator = ValidatorNotBlank
            )

            if (name != profile.name) {
                profile = profile.copy(name = name)
            }
        }
    }

    fun inputUrl() {
        if (profile.type == Profile.Type.External)
            return

        launch {
            val url = context.requestModelTextInput(
                initial = profile.source,
                title = context.getText(R.string.url),
                hint = context.getText(R.string.profile_url),
                error = context.getText(R.string.accept_http_content),
                validator = ValidatorHttpUrl
            )

            if (url != profile.source) {
                profile = profile.copy(source = url)
            }
        }
    }

    fun inputAgeSecretKey() {
        launch {
            val ageSecretKey = context.requestModelTextInput(
                initial = profile.ageSecretKey ?: "",
                title = context.getText(R.string.age_secret_key),
                hint = context.getText(R.string.age_secret_key_hint),
                error = context.getText(R.string.age_secret_key_error),
                validator = ValidatorAgeSecretKey
            )

            val newKey = ageSecretKey.ifBlank { null }
            if (newKey != profile.ageSecretKey) {
                profile = profile.copy(ageSecretKey = newKey)
            }
        }
    }

    fun inputInterval() {
        launch {
            var minutes = TimeUnit.MILLISECONDS.toMinutes(profile.interval)

            minutes = context.requestModelTextInput(
                initial = if (minutes == 0L) "" else minutes.toString(),
                title = context.getText(R.string.auto_update),
                hint = context.getText(R.string.auto_update_minutes),
                error = context.getText(R.string.at_least_15_minutes),
                validator = ValidatorAutoUpdateInterval
            ).toLongOrNull() ?: 0

            val interval = TimeUnit.MINUTES.toMillis(minutes)

            if (interval != profile.interval) {
                profile = profile.copy(interval = interval)
            }
        }
    }

    fun requestCommit() {
        requests.trySend(Request.Commit)
    }

    fun requestBrowseFiles() {
        requests.trySend(Request.BrowseFiles)
    }

    private fun ModelProgressBarConfigure.applyFrom(status: FetchStatus) {
        when (status.action) {
            FetchStatus.Action.FetchConfiguration -> {
                text = context.getString(R.string.format_fetching_configuration, status.args[0])
                isIndeterminate = true
            }
            FetchStatus.Action.FetchProviders -> {
                text = context.getString(R.string.format_fetching_provider, status.args[0])
                isIndeterminate = false
                max = status.max
                progress = status.progress
            }
            FetchStatus.Action.SubscriptionInfo -> Unit
            FetchStatus.Action.Verifying -> {
                text = context.getString(R.string.verifying)
                isIndeterminate = false
                max = status.max
                progress = status.progress
            }
        }
    }
}
