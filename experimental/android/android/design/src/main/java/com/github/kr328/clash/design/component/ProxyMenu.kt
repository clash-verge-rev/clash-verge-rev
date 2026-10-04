package com.github.kr328.clash.design.component

import android.content.Context
import android.view.MenuItem
import android.view.View
import androidx.appcompat.widget.PopupMenu
import com.github.kr328.clash.core.model.ProxySort
import com.github.kr328.clash.core.model.TunnelState
import com.github.kr328.clash.design.ProxyDesign
import com.github.kr328.clash.design.R
import com.github.kr328.clash.design.store.UiStore
import kotlinx.coroutines.channels.Channel

class ProxyMenu(
    context: Context,
    menuView: View,
    mode: TunnelState.Mode?,
    private val uiStore: UiStore,
    private val requests: Channel<ProxyDesign.Request>,
    private val updateConfig: () -> Unit,
) : PopupMenu.OnMenuItemClickListener {
    private val menu = PopupMenu(context, menuView)

    fun show() {
        menu.show()
    }

    override fun onMenuItemClick(item: MenuItem): Boolean {
        item.isChecked = !item.isChecked

        when (item.itemId) {
            R.id.not_selectable -> {
                uiStore.proxyExcludeNotSelectable = item.isChecked

                requests.trySend(ProxyDesign.Request.ReLaunch)
            }
            R.id.single -> {
                uiStore.proxyLine = 1

                updateConfig()

                requests.trySend(ProxyDesign.Request.ReloadAll)
            }
            R.id.doubles -> {
                uiStore.proxyLine = 2

                updateConfig()

                requests.trySend(ProxyDesign.Request.ReloadAll)
            }
            R.id.multiple -> {
                uiStore.proxyLine = 3

                updateConfig()

                requests.trySend(ProxyDesign.Request.ReloadAll)
            }
            R.id.default_ -> {
                uiStore.proxySort = ProxySort.Default

                requests.trySend(ProxyDesign.Request.ReloadAll)
            }
            R.id.name -> {
                uiStore.proxySort = ProxySort.Title

                requests.trySend(ProxyDesign.Request.ReloadAll)
            }
            R.id.delay -> {
                uiStore.proxySort = ProxySort.Delay

                requests.trySend(ProxyDesign.Request.ReloadAll)
            }
            R.id.dont_modify -> {
                requests.trySend(ProxyDesign.Request.PatchMode(null))
            }
            R.id.direct_mode -> {
                requests.trySend(ProxyDesign.Request.PatchMode(TunnelState.Mode.Direct))
            }
            R.id.global_mode -> {
                requests.trySend(ProxyDesign.Request.PatchMode(TunnelState.Mode.Global))
            }
            R.id.rule_mode -> {
                requests.trySend(ProxyDesign.Request.PatchMode(TunnelState.Mode.Rule))
            }
            else -> return false
        }

        return true
    }

    init {
        menu.menuInflater.inflate(R.menu.menu_proxy, menu.menu)

        menu.menu.apply {
            findItem(R.id.not_selectable).isChecked = uiStore.proxyExcludeNotSelectable

            when (uiStore.proxyLine){
                1 -> findItem(R.id.single).isChecked = true
                2 -> findItem(R.id.doubles).isChecked = true
                3 -> findItem(R.id.multiple).isChecked = true
            }

            when (uiStore.proxySort) {
                ProxySort.Default -> findItem(R.id.default_).isChecked = true
                ProxySort.Title -> findItem(R.id.name).isChecked = true
                ProxySort.Delay -> findItem(R.id.delay).isChecked = true
            }

            when (mode) {
                null -> findItem(R.id.dont_modify).isChecked = true
                TunnelState.Mode.Direct -> findItem(R.id.direct_mode).isChecked = true
                TunnelState.Mode.Global -> findItem(R.id.global_mode).isChecked = true
                TunnelState.Mode.Rule -> findItem(R.id.rule_mode).isChecked = true
                else -> {}
            }
        }

        menu.setOnMenuItemClickListener(this)
    }
}
