package com.collapse.safelinks.sync

import com.collapse.safelinks.content.Packs
import com.collapse.safelinks.dtn.*
import kotlinx.serialization.json.*
import java.io.DataInputStream
import java.io.DataOutputStream
import java.util.concurrent.Executors

/**
 * This device's DTN state, plus the callbacks that install verified packs and keyrings.
 * trust() returns the current keyring version and the trusted keys.
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
)

/**
 * One sync exchange over any byte stream (BLE GATT channel, socket, or a test pipe).
 * Frames: 4-byte big-endian length + UTF-8 JSON. Order: hello, sum, push, final. Both sides run the same steps.
 * Writes happen on a dedicated thread so large pushes cannot deadlock against the peer's reads.
 */
object SyncProtocol {
    const val MAX_FRAME = 8 * 1024 * 1024

    class SyncResult(val peerAddr: String, val delivered: List<Delivered>)

    fun run(input: DataInputStream, output: DataOutputStream, node: Node, now: Long): SyncResult {
        val writer = Executors.newSingleThreadExecutor()
        try {
            fun send(o: JsonObject) {
                val bytes = o.toString().toByteArray(Charsets.UTF_8)
                writer.submit { output.writeInt(bytes.size); output.write(bytes); output.flush() }.get()
            }
            fun recv(expect: String): JsonObject {
                val n = input.readInt()
                require(n in 1..MAX_FRAME) { "bad frame size $n" }
                val o = Json.parseToJsonElement(String(input.readNBytes(n), Charsets.UTF_8)).jsonObject
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
            return SyncResult(peerAddr, delivered)
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
