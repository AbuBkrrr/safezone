package com.collapse.safelinks.dtn

import com.collapse.safelinks.sync.Node
import com.collapse.safelinks.sync.SyncProtocol
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.*
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** Runs the real sync protocol between two nodes over in-memory pipes (stands in for a radio link). */
class SyncTest {
    private val now = 1_800_000_000L
    private val noMaintainer = ByteArray(32)

    private fun node(id: Identity, store: DtnStore = DtnStore()) =
        Node(id, store, { 0 to listOf(ByteArray(32)) }, 0, 0, { _, _ -> }, { _, _ -> }, { }, com.collapse.safelinks.content.VideoStore(java.nio.file.Files.createTempDirectory("v").toFile()))

    private fun link(a: Node, b: Node, t: Long): Pair<SyncProtocol.SyncResult, SyncProtocol.SyncResult> {
        val a2b = PipedOutputStream(); val b2a = PipedOutputStream()
        val aIn = PipedInputStream(a2b, 1 shl 20); val bIn = PipedInputStream(b2a, 1 shl 20)
        val pool = Executors.newFixedThreadPool(2)
        val fa: Future<SyncProtocol.SyncResult> = pool.submit<SyncProtocol.SyncResult> {
            SyncProtocol.run(DataInputStream(bIn), DataOutputStream(a2b), a, t).also { a2b.close() }
        }
        val fb: Future<SyncProtocol.SyncResult> = pool.submit<SyncProtocol.SyncResult> {
            SyncProtocol.run(DataInputStream(aIn), DataOutputStream(b2a), b, t).also { b2a.close() }
        }
        val r = fa.get() to fb.get()
        pool.shutdown()
        return r
    }

    @Test fun messageHopsThroughRelayWithNoNetwork() {
        val a = Identity.generate(); val b = Identity.generate(); val c = Identity.generate()
        val na = node(a); val nb = node(b); val nc = node(c)
        val m = makeBundle(a, c.address, "msg", buildJsonObject { put("text", "hi C via B") }, now, 6 * 3600)
        na.store.bundles[m.id] = m

        link(na, nb, now + 60)            // A meets B: B takes a spray copy
        assertNotNull(nb.store.bundles[m.id])
        link(nb, nc, now + 120)           // B meets C: delivery
        assertEquals(listOf("hi C via B"), nc.store.inbox.map { it.body.jsonObject["text"]!!.jsonPrimitive.content })

        link(nc, na, now + 180)           // ack reaches A
        assertNull(na.store.bundles[m.id])
    }

    @Test fun syncWithNothingToSendIsSafe() {
        val a = node(Identity.generate()); val b = node(Identity.generate())
        val (ra, rb) = link(a, b, now)
        assertEquals(0, ra.delivered.size + rb.delivered.size)
    }

    @Test fun payloadLargerThanPipeBufferStillSyncs() {
        val a = Identity.generate(); val c = Identity.generate()
        val na = node(a); val nc = node(c)
        val big = "x".repeat(200_000)
        val m = makeBundle(a, c.address, "msg", buildJsonObject { put("text", big) }, now, 6 * 3600)
        na.store.bundles[m.id] = m
        link(na, nc, now + 5)
        assertEquals(big.length, nc.store.inbox[0].body.jsonObject["text"]!!.jsonPrimitive.content.length)
    }

    @Test fun videoMovesInTwoSessionsWithinBudget() {
        val data = ByteArray(300_000).also { java.util.Random(7).nextBytes(it) }
        val cs = 16384
        val hashes = (0 until (data.size + cs - 1) / cs).map { i ->
            com.collapse.safelinks.content.VideoStore.sha256Hex(data.copyOfRange(i * cs, minOf(data.size, (i + 1) * cs)))
        }
        val m = com.collapse.safelinks.content.VideoManifest("clip-1", "Clip", data.size.toLong(),
            com.collapse.safelinks.content.VideoStore.sha256Hex(data), cs, hashes)
        val a = node(Identity.generate()); val b = node(Identity.generate())
        a.videos.register(listOf(m)); b.videos.register(listOf(m))
        val src = java.io.File.createTempFile("clip", ".mp4").also { it.writeBytes(data) }
        assertTrue(a.videos.seedFile("clip-1", src))
        a.blobBudget = 100_000
        link(a, b, now)
        assertFalse(b.videos.isInstalled("clip-1"))
        assertEquals(6, b.videos.have("clip-1").size)     // 6 pieces of 16 KB fit in 100 KB
        a.blobBudget = 8_000_000
        link(a, b, now + 60)                               // the next contact finishes the video
        assertTrue(b.videos.isInstalled("clip-1"))
        assertArrayEquals(data, java.io.File(b.videos.installedPath("clip-1")!!).readBytes())
    }
}
