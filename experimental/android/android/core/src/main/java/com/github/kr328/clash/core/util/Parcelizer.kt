package com.github.kr328.clash.core.util

import android.os.Parcel
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerializationStrategy
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.CompositeDecoder
import kotlinx.serialization.encoding.CompositeEncoder
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.modules.EmptySerializersModule
import kotlinx.serialization.modules.SerializersModule

object Parcelizer {
    private class ParcelDecoder(private val parcel: Parcel) : Decoder, CompositeDecoder {
        override val serializersModule: SerializersModule = SerializersModule {}

        @ExperimentalSerializationApi
        override fun decodeSequentially(): Boolean = true
        override fun decodeByteElement(descriptor: SerialDescriptor, index: Int) = decodeByte()
        override fun decodeCharElement(descriptor: SerialDescriptor, index: Int) = decodeChar()
        override fun decodeDoubleElement(descriptor: SerialDescriptor, index: Int) = decodeDouble()
        override fun decodeElementIndex(descriptor: SerialDescriptor) = decodeInt()
        override fun decodeFloatElement(descriptor: SerialDescriptor, index: Int) = decodeFloat()
        override fun decodeBooleanElement(descriptor: SerialDescriptor, index: Int) =
            decodeBoolean()

        @ExperimentalSerializationApi
        override fun decodeInlineElement(descriptor: SerialDescriptor, index: Int): Decoder {
            return this
        }

        override fun decodeIntElement(descriptor: SerialDescriptor, index: Int) = decodeInt()
        override fun decodeLongElement(descriptor: SerialDescriptor, index: Int) = decodeLong()
        override fun decodeShortElement(descriptor: SerialDescriptor, index: Int) = decodeShort()
        override fun decodeStringElement(descriptor: SerialDescriptor, index: Int) = decodeString()

        @ExperimentalSerializationApi
        override fun <T : Any> decodeNullableSerializableElement(
            descriptor: SerialDescriptor,
            index: Int,
            deserializer: DeserializationStrategy<T?>,
            previousValue: T?
        ): T? = decodeNullableSerializableValue(deserializer)

        override fun <T> decodeSerializableElement(
            descriptor: SerialDescriptor,
            index: Int,
            deserializer: DeserializationStrategy<T>,
            previousValue: T?
        ): T = decodeSerializableValue(deserializer)


        override fun endStructure(descriptor: SerialDescriptor) {

        }

        override fun beginStructure(descriptor: SerialDescriptor): CompositeDecoder {
            return this
        }

        override fun decodeCollectionSize(descriptor: SerialDescriptor): Int {
            return decodeInt()
        }

        override fun decodeBoolean(): Boolean {
            return decodeByte() != (0.toByte())
        }

        override fun decodeByte(): Byte {
            return parcel.readByte()
        }

        override fun decodeChar(): Char {
            return decodeInt().toChar()
        }

        override fun decodeDouble(): Double {
            return parcel.readDouble()
        }

        override fun decodeEnum(enumDescriptor: SerialDescriptor): Int {
            return decodeInt()
        }

        override fun decodeFloat(): Float {
            return parcel.readFloat()
        }

        @ExperimentalSerializationApi
        override fun decodeInline(inlineDescriptor: SerialDescriptor): Decoder {
            return this
        }

        override fun decodeInt(): Int {
            return parcel.readInt()
        }

        override fun decodeLong(): Long {
            return parcel.readLong()
        }

        @ExperimentalSerializationApi
        override fun decodeNotNullMark(): Boolean {
            return decodeBoolean()
        }

        @ExperimentalSerializationApi
        override fun decodeNull(): Nothing? {
            return null
        }

        override fun decodeShort(): Short {
            return decodeInt().toShort()
        }

        override fun decodeString(): String {
            return parcel.readString()!!
        }
    }

    private class ParcelEncoder(private val parcel: Parcel) : Encoder, CompositeEncoder {
        override val serializersModule: SerializersModule = SerializersModule {}

        override fun encodeBooleanElement(
            descriptor: SerialDescriptor,
            index: Int,
            value: Boolean
        ) = encodeBoolean(value)

        override fun encodeByteElement(descriptor: SerialDescriptor, index: Int, value: Byte) =
            encodeByte(value)

        override fun encodeCharElement(descriptor: SerialDescriptor, index: Int, value: Char) =
            encodeChar(value)

        override fun encodeDoubleElement(descriptor: SerialDescriptor, index: Int, value: Double) =
            encodeDouble(value)

        override fun encodeFloatElement(descriptor: SerialDescriptor, index: Int, value: Float) =
            encodeFloat(value)

        @ExperimentalSerializationApi
        override fun encodeInlineElement(descriptor: SerialDescriptor, index: Int): Encoder {
            return this
        }

        override fun encodeIntElement(descriptor: SerialDescriptor, index: Int, value: Int) =
            encodeInt(value)

        override fun encodeLongElement(descriptor: SerialDescriptor, index: Int, value: Long) =
            encodeLong(value)

        override fun encodeShortElement(descriptor: SerialDescriptor, index: Int, value: Short) =
            encodeShort(value)

        override fun encodeStringElement(descriptor: SerialDescriptor, index: Int, value: String) =
            encodeString(value)

        @ExperimentalSerializationApi
        override fun <T : Any> encodeNullableSerializableElement(
            descriptor: SerialDescriptor,
            index: Int,
            serializer: SerializationStrategy<T>,
            value: T?
        ) = encodeNullableSerializableValue(serializer, value)

        override fun <T> encodeSerializableElement(
            descriptor: SerialDescriptor,
            index: Int,
            serializer: SerializationStrategy<T>,
            value: T
        ) = encodeSerializableValue(serializer, value)

        override fun endStructure(descriptor: SerialDescriptor) {

        }

        override fun beginStructure(descriptor: SerialDescriptor): CompositeEncoder {
            return this
        }

        override fun beginCollection(
            descriptor: SerialDescriptor,
            collectionSize: Int
        ): CompositeEncoder {
            encodeInt(collectionSize)

            return super.beginCollection(descriptor, collectionSize)
        }

        override fun encodeBoolean(value: Boolean) {
            encodeByte(if (value) 1 else 0)
        }

        override fun encodeByte(value: Byte) {
            parcel.writeByte(value)
        }

        override fun encodeChar(value: Char) {
            encodeInt(value.code)
        }

        override fun encodeDouble(value: Double) {
            parcel.writeDouble(value)
        }

        override fun encodeEnum(enumDescriptor: SerialDescriptor, index: Int) {
            encodeInt(index)
        }

        override fun encodeFloat(value: Float) {
            parcel.writeFloat(value)
        }

        @ExperimentalSerializationApi
        override fun encodeInline(inlineDescriptor: SerialDescriptor): Encoder {
            return this
        }

        override fun encodeInt(value: Int) {
            parcel.writeInt(value)
        }

        override fun encodeLong(value: Long) {
            parcel.writeLong(value)
        }

        @ExperimentalSerializationApi
        override fun encodeNull() {
            encodeBoolean(false)
        }

        override fun encodeShort(value: Short) {
            encodeInt(value.toInt())
        }

        override fun encodeString(value: String) {
            parcel.writeString(value)
        }

        @ExperimentalSerializationApi
        override fun encodeNotNullMark() {
            encodeBoolean(true)
        }
    }

    fun <T> decodeFromParcel(deserializer: DeserializationStrategy<T>, parcel: Parcel): T {
        return deserializer.deserialize(ParcelDecoder(parcel))
    }

    fun <T> encodeToParcel(serializer: SerializationStrategy<T>, parcel: Parcel, value: T) {
        serializer.serialize(ParcelEncoder(parcel), value)
    }
}