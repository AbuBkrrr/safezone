package com.collapse.safelinks.sync

import com.collapse.safelinks.content.Packs
import com.collapse.safelinks.content.VideoStore
import com.collapse.safelinks.dtn.*
import kotlinx.serialization.json.*
import java.io.DataInputStream
import java.io.DataOutputStream
import java.util.Base64
import java.util.concurrent.Executors

/**
 * This device's DTN state, plus the callbacks that install verified packs and keyrings, and the video store.
 * blobBudget caps how many video bytes one session may send, so a large video spreads over several contacts.
 */
class Node(
    val identity: Identity,
    val store: DtnStore,
    val trust: () -> Pair<Int, List<ByteArray>>,
    var packVersion: Int,
    var keyringVersion: Int,
    val onPack: (version: Int, pack: JsonObject) -> Unit,
    val onKeyring: (version: Int, keys: List<String>) -> Unit,
    val save: (DtnStore) -> Unit,
    val videos: VideoStore,
    var blobBudget: Long = 8_000_000L,
)

/**
 * One sync exchange over any byte stream (BLE GATT channel, socket, or a test pipe).
 * Frames: 4-byte big-endian length + UTF-8 JSON.
 * Message phase: hello, sum, push, final (both sides run the same steps).
 * Install: verified keyrings, then packs (which register video manifests).
 * Video phase: have (piece lists), then each side streams the pieces the other lacks, up to its budget,
 * while receiving the other side's pieces. Every piece is checked against its signed hash.
 */
object SyncProtocol {
    const val MAX_FRAME = 8 * 1024 * 1024

    class SyncResult(val peerAddr: String, val delivered: List<Delivered>, val piecesReceived: Int)

    fun run(input: DataInputStream, output: DataOutputStream, node: Node, now: Long): SyncResult {
        val writer = Executors.newSingleThreadExecutor()
        try {
            fun send(o: JsonObject) {
                val bytes = o.toString().toByteArray(Charsets.UTF_8)
                writer.submit { output.writeInt(bytes.size); output.write(bytes); output.flush() }.get()
            }
            fun readFrame(): JsonObject {
                val n = input.readInt()
                require(n in 1..MAX_FRAME) { "bad frame size $n" }
                return Json.parseToJsonElement(String(input.readNBytes(n), Charsets.UTF_8)).jsonObject
            }
            fun recv(expect: String): JsonObject {
                val o = readFrame()
                require(o["type"]!!.jsonPrimitive.content == expect) { "expected $expect" }
                return o
            }
            val me = node.identity
            val store = node.store

            send(buildJsonObject { put("type", "hello"); put("addr", me.address) })
            val peerAddr = recv("hello")["addr"]!!.jsonPrimitive.content
            require(peerAddr.length == 128 && peerAddr != me.address) { "bad peer address" }

            send(buildJsonObject {
                put("type", "sum")
                put("ids", JsonArray(store.summaryIds(now).map { JsonPrimitive(it) }))
                put("acks", JsonArray(store.summaryAcks().map { JsonPrimitive(it) }))
            })
            val ps = recv("sum")
            val peerIds = ps["ids"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()
            val peerAcks = ps["acks"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()

            val planned = store.plan(peerIds, peerAcks, peerAddr, now)
            send(buildJsonObject { put("type", "push"); put("msg", planned.toJson()) })
            val pushMsg = SyncMsg.fromJson(recv("push")["msg"]!!.jsonObject)

            val acksBefore = store.acks.keys.toSet()
            val delivered = store.receive(pushMsg, me, now) { b -> node.trust().second.any { it.contentEquals(unhex(b.src.substring(0, 64))) } }
            val newAcks = store.acks.values.filter { it.bundleId !in acksBefore }

            send(buildJsonObject { put("type", "final"); put("acks", JsonArray(newAcks.map { it.toJson() })) })
            val finalAcks = recv("final")["acks"]!!.jsonArray.map { Ack.fromJson(it.jsonObject) }
            store.receive(SyncMsg(emptyList(), finalAcks), me, now) { false }
            node.save(store)

            for (d in delivered) install(node, d)

            // Video phase.
            val mine = node.videos.manifests()
            send(buildJsonObject {
                put("type", "have")
                put("videos", buildJsonObject { mine.forEach { m -> put(m.id, JsonArray(node.videos.have(m.id).map { JsonPrimitive(it) })) } })
            })
            val peerHave = recv("have")["videos"]!!.jsonObject.mapValues { (_, v) -> v.jsonArray.map { it.jsonPrimitive.int }.toSet() }

            var sendError: Throwable? = null
            val sender = Thread {
                try {
                    var budget = node.blobBudget
                    outer@ for (m in mine) {
                        val theirs = peerHave[m.id] ?: emptySet()
                        for (i in node.videos.have(m.id)) {
                            if (i in theirs) continue
                            val data = node.videos.readChunk(m.id, i) ?: continue
                            if (data.size > budget) break@outer
                            budget -= data.size
                            val frame = buildJsonObject {
                                put("type", "piece"); put("id", m.id); put("i", i)
                                put("data", Base64.getEncoder().encodeToString(data))
                            }.toString().toByteArray(Charsets.UTF_8)
                            output.writeInt(frame.size); output.write(frame)
                        }
                    }
                    val done = buildJsonObject { put("type", "pieces_done") }.toString().toByteArray(Charsets.UTF_8)
                    output.writeInt(done.size); output.write(done); output.flush()
                } catch (e: Throwable) {
                    sendError = e
                }
            }
            sender.start()
            var received = 0
            try {
                while (true) {
                    val f = readFrame()
                    when (f["type"]!!.jsonPrimitive.content) {
                        "pieces_done" -> break
                        "piece" -> {
                            val ok = node.videos.putChunk(
                                f["id"]!!.jsonPrimitive.content,
                                f["i"]!!.jsonPrimitive.int,
                                Base64.getDecoder().decode(f["data"]!!.jsonPrimitive.content),
                            )
                            if (ok) received++
                        }
                        else -> error("unexpected frame in video phase")
                    }
                }
            } finally {
                sender.join()
            }
            sendError?.let { throw it }
            return SyncResult(peerAddr, delivered, received)
        } finally {
            writer.shutdownNow()
        }
    }

    /** Keyrings first, then packs, so a pack signed by a newly trusted key is accepted in the same sync. */
    private fun install(node: Node, d: Delivered) {
        val bundle = node.store.bundles[d.id] ?: return
        val (kv, keys) = node.trust()
        when (d.kind) {
            Packs.KEYRING_KIND -> {
                val r = Packs.verifyKeyring(bundle, d.body, kv, keys)
                if (r is Packs.KeyringResult.Ok) {
                    node.keyringVersion = r.version
                    node.onKeyring(r.version, r.keys)
                }
            }
            Packs.KIND -> {
                val r = Packs.verify(bundle, d.body, node.packVersion, keys)
                if (r is Packs.Result.Ok) {
                    node.packVersion = r.version
                    node.onPack(r.version, r.pack)
                }
            }
        }
    }
}
