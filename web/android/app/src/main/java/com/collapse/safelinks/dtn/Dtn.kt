package com.collapse.safelinks.dtn

import kotlinx.serialization.json.*
import org.bouncycastle.crypto.agreement.X25519Agreement
import org.bouncycastle.crypto.modes.ChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.params.KeyParameter
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Store-carry-forward core, ported from web/lib/dtn/core.ts. Same rules and wire header:
 * - address = signPub(32) + boxPub(32), hex
 * - unicast body = ChaCha20-Poly1305(key = SHA-256(X25519 shared secret)); broadcast body = plain JSON
 * - header signed by the source Ed25519 key over the canonical header
 * - spray-and-wait with SPRAY copies, acks signed by the recipient, TTL, store caps
 * Note: the encryption primitive differs from the web build (which uses NaCl box), so
 * unicast messages do not interoperate between the web app and the native app.
 */
object Dtn {
    const val BROADCAST = "*"
    const val SPRAY = 8
    const val MAX_BUNDLES = 400
    const val MAX_ACKS = 2000
    const val ACK_LIFETIME_S = 7L * 24 * 3600
    const val MAX_SKEW_S = 300L
    const val MAX_TTL_S = 30L * 24 * 3600
    const val SEP = "collapse-dtn-v1|"
}

fun hex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }
fun unhex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
private fun sha512(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-512").digest(b)
private fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)
private fun random(n: Int): ByteArray = ByteArray(n).also { SecureRandom().nextBytes(it) }

class Identity(val signSeed: ByteArray, val boxSeed: ByteArray) {
    val signPub: ByteArray = Ed25519PrivateKeyParameters(signSeed, 0).generatePublicKey().encoded
    val boxPub: ByteArray = X25519PrivateKeyParameters(boxSeed, 0).generatePublicKey().encoded
    val address: String get() = hex(signPub) + hex(boxPub)

    fun sign(msg: ByteArray): ByteArray {
        val s = Ed25519Signer()
        s.init(true, Ed25519PrivateKeyParameters(signSeed, 0))
        s.update(msg, 0, msg.size)
        return s.generateSignature()
    }

    companion object {
        fun generate() = Identity(random(32), random(32))
    }
}

fun addressSignPub(addr: String): ByteArray = unhex(addr.substring(0, 64))
fun addressBoxPub(addr: String): ByteArray = unhex(addr.substring(64))

fun verifySig(pub: ByteArray, msg: ByteArray, sig: ByteArray): Boolean = try {
    val v = Ed25519Signer()
    v.init(false, Ed25519PublicKeyParameters(pub, 0))
    v.update(msg, 0, msg.size)
    v.verifySignature(sig)
} catch (_: Exception) {
    false
}

@Suppress("unused")
private fun chacha(encrypt: Boolean, key: ByteArray, nonce: ByteArray, input: ByteArray): ByteArray {
    val c = ChaCha20Poly1305()
    c.init(encrypt, AEADParameters(KeyParameter(key), 128, nonce))
    val out = ByteArray(c.getOutputSize(input.size))
    val n = c.processBytes(input, 0, input.size, out, 0)
    val m = c.doFinal(out, n)
    return out.copyOf(n + m)
}

private fun sharedKey(myBoxSeed: ByteArray, theirBoxPub: ByteArray): ByteArray {
    val a = X25519Agreement()
    a.init(X25519PrivateKeyParameters(myBoxSeed, 0))
    val shared = ByteArray(32)
    a.calculateAgreement(X25519PublicKeyParameters(theirBoxPub, 0), shared, 0)
    return sha256(shared)
}

/** Canonical JSON: sorted keys, no whitespace. Matches web/lib/canonical.ts for the value shapes used here. */
fun canonical(e: JsonElement): String = when (e) {
    is JsonObject -> e.keys.sorted().joinToString(",", "{", "}") { "\"$it\":" + canonical(e[it]!!) }
    is JsonArray -> e.joinToString(",", "[", "]") { canonical(it) }
    is JsonPrimitive -> e.toString()
}

data class Bundle(
    val id: String,
    val src: String,
    val dst: String,
    val created: Long,
    val ttl: Long,
    val nonce: String,
    val body: String,
    val sig: String,
    val copies: Int,
) {
    fun toJson(): JsonObject = buildJsonObject {
        put("id", id); put("src", src); put("dst", dst); put("created", created); put("ttl", ttl)
        put("nonce", nonce); put("body", body); put("sig", sig); put("copies", copies)
    }

    companion object {
        fun fromJson(o: JsonObject): Bundle = Bundle(
            o.str("id"), o.str("src"), o.str("dst"), o.long("created"), o.long("ttl"),
            o.str("nonce"), o.str("body"), o.str("sig"), o.long("copies").toInt(),
        )
    }
}

internal fun JsonObject.str(k: String): String = this[k]!!.jsonPrimitive.content
internal fun JsonObject.long(k: String): Long = this[k]!!.jsonPrimitive.long

data class Ack(val bundleId: String, val dst: String, val at: Long, val sig: String) {
    fun toJson(): JsonObject = buildJsonObject { put("bundleId", bundleId); put("dst", dst); put("at", at); put("sig", sig) }

    companion object {
        fun fromJson(o: JsonObject) = Ack(o.str("bundleId"), o.str("dst"), o.long("at"), o.str("sig"))
    }
}

data class Delivered(val id: String, val from: String, val kind: String, val body: JsonElement, val at: Long) {
    fun toJson(): JsonObject = buildJsonObject { put("id", id); put("from", from); put("kind", kind); put("body", body); put("at", at) }

    companion object {
        fun fromJson(o: JsonObject) = Delivered(o.str("id"), o.str("from"), o.str("kind"), o["body"]!!, o.long("at"))
    }
}

class Opened(val kind: String, val body: JsonElement, val from: String)

fun headerString(src: String, dst: String, created: Long, ttl: Long, nonce: String, body: String): String =
    Dtn.SEP + canonical(buildJsonObject {
        put("src", src); put("dst", dst); put("created", created); put("ttl", ttl); put("nonce", nonce); put("body", body)
    })

fun bundleId(header: String): String = hex(sha512(header.toByteArray())).substring(0, 32)

fun makeBundle(me: Identity, dst: String, kind: String, body: JsonElement, now: Long, ttl: Long, copies: Int = Dtn.SPRAY): Bundle {
    val src = me.address
    val plain = canonical(buildJsonObject { put("kind", kind); put("body", body) }).toByteArray()
    val nonce: String
    val cipher: ByteArray
    if (dst == Dtn.BROADCAST) {
        nonce = ""
        cipher = plain
    } else {
        require(dst.length == 128 && dst.all { it in '0'..'9' || it in 'a'..'f' }) { "bad address" }
        val n = random(12)
        nonce = hex(n)
        cipher = chacha(true, sharedKey(me.boxSeed, addressBoxPub(dst)), n, plain)
    }
    val bodyHex = hex(cipher)
    val header = headerString(src, dst, now, ttl, nonce, bodyHex)
    val sig = hex(me.sign(header.toByteArray()))
    return Bundle(bundleId(header), src, dst, now, ttl, nonce, bodyHex, sig, copies)
}

fun isExpired(created: Long, ttl: Long, now: Long): Boolean = now >= created + ttl

fun verifyBundle(b: Bundle, now: Long): Boolean {
    if (b.src.length != 128) return false
    if (b.dst != Dtn.BROADCAST && b.dst.length != 128) return false
    if (b.ttl <= 0 || b.ttl > Dtn.MAX_TTL_S) return false
    if (b.created > now + Dtn.MAX_SKEW_S) return false
    if (isExpired(b.created, b.ttl, now)) return false
    if (b.copies < 0) return false
    val header = headerString(b.src, b.dst, b.created, b.ttl, b.nonce, b.body)
    if (bundleId(header) != b.id) return false
    return verifySig(addressSignPub(b.src), header.toByteArray(), unhex(b.sig))
}

fun openBundle(b: Bundle, me: Identity): Opened? {
    if (b.dst != Dtn.BROADCAST && b.dst != me.address) return null
    return try {
        val plain = if (b.dst == Dtn.BROADCAST) unhex(b.body)
            else chacha(false, sharedKey(me.boxSeed, addressBoxPub(b.src)), unhex(b.nonce), unhex(b.body))
        val o = Json.parseToJsonElement(String(plain)).jsonObject
        Opened(o.str("kind"), o["body"]!!, b.src)
    } catch (_: Exception) {
        null
    }
}

fun makeAck(me: Identity, bundleId: String, now: Long): Ack {
    val dst = me.address
    return Ack(bundleId, dst, now, hex(me.sign("ack|$bundleId|$dst|$now".toByteArray())))
}

fun verifyAck(a: Ack): Boolean = verifySig(addressSignPub(a.dst), "ack|${a.bundleId}|${a.dst}|${a.at}".toByteArray(), unhex(a.sig))

/** The state of one device's DTN store. Mirrors DtnState in the web build. */
class DtnStore {
    val bundles = LinkedHashMap<String, Bundle>()
    val acks = LinkedHashMap<String, Ack>()
    val delivered = LinkedHashMap<String, Long>()
    val inbox = ArrayList<Delivered>()

    fun summaryIds(now: Long): List<String> =
        bundles.values.filter { !isExpired(it.created, it.ttl, now) }.map { it.id } + delivered.keys
    fun summaryAcks(): List<String> = acks.keys.toList()

    /** Messages to send to a peer. Hands over spray copies by halving them, so the total never grows. */
    fun plan(peerIds: Set<String>, peerAcks: Set<String>, peerAddr: String, now: Long): SyncMsg {
        val out = ArrayList<Bundle>()
        for (b in bundles.values.toList()) {
            if (isExpired(b.created, b.ttl, now) || b.id in peerIds || acks.containsKey(b.id)) continue
            if (b.dst == Dtn.BROADCAST || b.dst == peerAddr) {
                out.add(b)
            } else if (b.copies > 1) {
                val give = b.copies / 2
                bundles[b.id] = b.copy(copies = b.copies - give)
                out.add(b.copy(copies = give))
            }
        }
        return SyncMsg(out, acks.values.filter { it.bundleId !in peerAcks })
    }

    /** Applies a peer's message and returns what was delivered to this device. */
    fun receive(msg: SyncMsg, me: Identity, now: Long, allowBroadcast: (Bundle) -> Boolean): List<Delivered> {
        for (a in msg.acks) {
            if (!verifyAck(a) || now - a.at > Dtn.ACK_LIFETIME_S || a.at > now + Dtn.MAX_SKEW_S) continue
            if (!acks.containsKey(a.bundleId) && acks.size >= Dtn.MAX_ACKS) continue
            acks[a.bundleId] = a
            val held = bundles[a.bundleId]
            if (held != null && held.dst == a.dst) bundles.remove(a.bundleId)
        }
        val delivered = ArrayList<Delivered>()
        for (b in msg.bundles) {
            if (delivered.any { it.id == b.id } || this.delivered.containsKey(b.id) || bundles.containsKey(b.id) || acks.containsKey(b.id)) continue
            if (!verifyBundle(b, now)) continue
            if (b.dst == Dtn.BROADCAST) {
                if (!allowBroadcast(b)) continue
                bundles[b.id] = b
                openBundle(b, me)?.let { o ->
                    val d = Delivered(b.id, o.from, o.kind, o.body, now)
                    this.delivered[b.id] = now; inbox.add(d); delivered.add(d)
                }
            } else if (b.dst == me.address) {
                val o = openBundle(b, me) ?: continue
                val d = Delivered(b.id, o.from, o.kind, o.body, now)
                this.delivered[b.id] = now; inbox.add(d); delivered.add(d)
                acks[b.id] = makeAck(me, b.id, now)
            } else {
                bundles[b.id] = b
            }
        }
        prune(now)
        return delivered
    }

    fun prune(now: Long) {
        bundles.values.filter { isExpired(it.created, it.ttl, now) }.map { it.id }.forEach { bundles.remove(it) }
        acks.values.filter { now - it.at > Dtn.ACK_LIFETIME_S }.map { it.bundleId }.forEach { acks.remove(it) }
        delivered.filter { now - it.value > Dtn.ACK_LIFETIME_S }.keys.toList().forEach { delivered.remove(it) }
        if (bundles.size > Dtn.MAX_BUNDLES) {
            bundles.values.sortedBy { it.created }.take(bundles.size - Dtn.MAX_BUNDLES).forEach { bundles.remove(it.id) }
        }
        while (inbox.size > 500) inbox.removeAt(0)
    }

    fun toJson(): JsonObject = buildJsonObject {
        put("bundles", JsonArray(bundles.values.map { it.toJson() }))
        put("acks", JsonArray(acks.values.map { it.toJson() }))
        put("delivered", buildJsonObject { delivered.forEach { (k, v) -> put(k, v) } })
        put("inbox", JsonArray(inbox.map { it.toJson() }))
    }

    companion object {
        fun fromJson(o: JsonObject): DtnStore {
            val s = DtnStore()
            o["bundles"]?.jsonArray?.forEach { val b = Bundle.fromJson(it.jsonObject); s.bundles[b.id] = b }
            o["acks"]?.jsonArray?.forEach { val a = Ack.fromJson(it.jsonObject); s.acks[a.bundleId] = a }
            o["delivered"]?.jsonObject?.forEach { (k, v) -> s.delivered[k] = v.jsonPrimitive.long }
            o["inbox"]?.jsonArray?.forEach { s.inbox.add(Delivered.fromJson(it.jsonObject)) }
            return s
        }
    }
}

/** One sync message: bundles to carry and acks to pass on. */
data class SyncMsg(val bundles: List<Bundle>, val acks: List<Ack>) {
    fun toJson(): JsonObject = buildJsonObject {
        put("bundles", JsonArray(bundles.map { it.toJson() }))
        put("acks", JsonArray(acks.map { it.toJson() }))
    }

    companion object {
        fun fromJson(o: JsonObject) = SyncMsg(
            o["bundles"]!!.jsonArray.map { Bundle.fromJson(it.jsonObject) },
            o["acks"]!!.jsonArray.map { Ack.fromJson(it.jsonObject) },
        )
    }
}
