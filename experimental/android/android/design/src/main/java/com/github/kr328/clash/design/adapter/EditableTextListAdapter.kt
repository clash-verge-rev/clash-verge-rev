package com.github.kr328.clash.design.adapter

import android.content.Context
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.github.kr328.clash.design.databinding.AdapterEditableTextListBinding
import com.github.kr328.clash.design.preference.TextAdapter
import com.github.kr328.clash.design.util.layoutInflater

class EditableTextListAdapter<T>(
    private val context: Context,
    val values: MutableList<T>,
    private val adapter: TextAdapter<T>,
) : RecyclerView.Adapter<EditableTextListAdapter.Holder>() {
    class Holder(val binding: AdapterEditableTextListBinding) :
        RecyclerView.ViewHolder(binding.root)

    fun addElement(text: String) {
        val value = adapter.to(text)

        notifyItemInserted(values.size)
        values.add(value)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        return Holder(
            AdapterEditableTextListBinding
                .inflate(context.layoutInflater, parent, false)
        )
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val current = values[position]

        holder.binding.textView.text = adapter.from(current)
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