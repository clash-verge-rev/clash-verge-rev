package com.github.kr328.clash.design.adapter

import android.content.Context
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.github.kr328.clash.design.databinding.AdapterEditableTextMapBinding
import com.github.kr328.clash.design.preference.TextAdapter
import com.github.kr328.clash.design.util.layoutInflater

class EditableTextMapAdapter<K, V>(
    private val context: Context,
    val values: MutableList<Pair<K, V>>,
    private val keyAdapter: TextAdapter<K>,
    private val valueAdapter: TextAdapter<V>,
) : RecyclerView.Adapter<EditableTextMapAdapter.Holder>() {
    class Holder(val binding: AdapterEditableTextMapBinding) : RecyclerView.ViewHolder(binding.root)

    fun addElement(key: String, value: String) {
        val keyValue = keyAdapter.to(key)
        val valueValue = valueAdapter.to(value)

        notifyItemInserted(values.size)
        values.add(keyValue to valueValue)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        return Holder(
            AdapterEditableTextMapBinding
                .inflate(context.layoutInflater, parent, false)
        )
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val current = values[position]

        holder.binding.keyView.text = keyAdapter.from(current.first)
        holder.binding.valueView.text = valueAdapter.from(current.second)
        holder.binding.deleteView.setOnClickListener {
            val index = values.indexOf(current)

            if (index >= 0) {
                values.removeAt(index)
                notifyItemRemoved(index)
            }
        }
    }

    override fun getItemCount(): Int {
        return values.size
    }
}