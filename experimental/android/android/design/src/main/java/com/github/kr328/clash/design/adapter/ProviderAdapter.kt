package com.github.kr328.clash.design.adapter

import android.content.Context
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.github.kr328.clash.core.model.Provider
import com.github.kr328.clash.design.databinding.AdapterProviderBinding
import com.github.kr328.clash.design.model.ProviderState
import com.github.kr328.clash.design.ui.ObservableCurrentTime
import com.github.kr328.clash.design.util.layoutInflater

class ProviderAdapter(
    private val context: Context,
    providers: List<Provider>,
    private val requestUpdate: (Int, Provider) -> Unit,
) : RecyclerView.Adapter<ProviderAdapter.Holder>() {
    class Holder(val binding: AdapterProviderBinding) : RecyclerView.ViewHolder(binding.root)

    private val currentTime = ObservableCurrentTime()

    val states = providers.map { ProviderState(it, it.updatedAt, false) }

    fun updateElapsed() {
        currentTime.update()
    }

    fun notifyUpdated(index: Int) {
        states[index].apply {
            updating = false
        }

        notifyItemChanged(index)
    }

    fun notifyChanged(index: Int) {
        states[index].apply {
            updating = false
            updatedAt = System.currentTimeMillis()
        }

        notifyItemChanged(index)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        return Holder(
            AdapterProviderBinding
                .inflate(context.layoutInflater, parent, false)
                .also { it.currentTime = currentTime }
        )
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val state = states[position]

        holder.binding.provider = state.provider
        holder.binding.state = state
        if (state.provider.vehicleType == Provider.VehicleType.Inline) {
            holder.binding.endView.visibility = View.GONE
            holder.binding.elapsedView.visibility = View.GONE
            holder.binding.divider.visibility = View.GONE
        } else {
            holder.binding.endView.visibility = View.VISIBLE
            holder.binding.elapsedView.visibility = View.VISIBLE
            holder.binding.update = View.OnClickListener {
                state.updating = true
                requestUpdate(position, state.provider)
            }
        }
    }

    override fun getItemCount(): Int {
        return states.size
    }
}