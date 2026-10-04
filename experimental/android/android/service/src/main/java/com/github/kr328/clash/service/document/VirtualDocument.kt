package com.github.kr328.clash.service.document

class VirtualDocument(
    override val id: String,
    override val name: String,
    override val mimeType: String,
    override val size: Long,
    override val updatedAt: Long,
    override val flags: Set<Flag>,
) : Document
