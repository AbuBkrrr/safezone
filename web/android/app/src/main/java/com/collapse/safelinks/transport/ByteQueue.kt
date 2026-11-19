package com.collapse.safelinks.transport

import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.LinkedBlockingQueue

/** A blocking byte pipe that is safe across threads. Used to bridge BLE callbacks and the sync protocol. */
class ByteQueue {
    private val q = LinkedBlockingQueue<ByteArray>()
    private var cur = ByteArray(0)
    private var pos = 0
    @Volatile private var closed = false

    fun put(b: ByteArray) {
        if (!closed && b.isNotEmpty()) q.put(b)
    }

    /** Ends the stream. Readers get -1 (or null from take) once queued bytes are consumed. */
    fun close() {
        if (closed) return
        closed = true
        q.put(EOF)
    }

    /** Next chunk for a writer thread, or null at end of stream. */
    fun take(): ByteArray? {
        val b = q.take()
        return if (b === EOF) null else b
    }

    val input: InputStream = object : InputStream() {
        override fun read(): Int {
            if (pos >= cur.size) {
                val b = q.take()
                if (b === EOF) return -1
                cur = b
                pos = 0
            }
            return cur[pos++].toInt() and 0xff
        }

        override fun read(buf: ByteArray, off: Int, len: Int): Int {
            if (len == 0) return 0
            val first = read()
            if (first < 0) return -1
            buf[off] = first.toByte()
            var n = 1
            while (n < len && pos < cur.size) {
                buf[off + n] = cur[pos++]
                n++
            }
            return n
        }
    }

    val output: OutputStream = object : OutputStream() {
        override fun write(b: Int) = put(byteArrayOf(b.toByte()))
        override fun write(b: ByteArray, off: Int, len: Int) = put(b.copyOfRange(off, off + len))
    }

    companion object {
        private val EOF = ByteArray(0)
    }
}
