package com.collapse.safelinks.content

import com.collapse.safelinks.dtn.Bundle
import com.collapse.safelinks.dtn.canonical
import com.collapse.safelinks.dtn.unhex
import com.collapse.safelinks.dtn.verifySig
import com.collapse.safelinks.content.VideoStore
import kotlinx.serialization.json.*

/**
 * Signed content packs and keyrings. A pack adds or changes quests and screens. A keyring replaces
 * the set of trusted maintainer keys (rotation). Both must be signed by a key the device already trusts,
 * and both must carry a version newer than the installed one, so old copies cannot be replayed.
 */
object Packs {
    const val NAME = "collapse-content"
    const val KEYRING_NAME = "collapse-keyring"
    const val KIND = "pack"
    const val KEYRING_KIND = "keyring"
    const val MAX_KEYS = 3

    sealed class Result {
        data class Ok(val version: Int, val pack: JsonObject) : Result()
        data class Refused(val reason: String) : Result()
    }

    sealed class KeyringResult {
        data class Ok(val version: Int, val keys: List<String>) : KeyringResult()
        data class Refused(val reason: String) : KeyringResult()
    }

    private fun trustedSigner(trusted: List<ByteArray>, msg: ByteArray, sig: ByteArray): Boolean =
        trusted.any { verifySig(it, msg, sig) }

    private fun fromTrusted(bundle: Bundle, trusted: List<ByteArray>): Boolean {
        val src = unhex(bundle.src.substring(0, 64))
        return trusted.any { it.contentEquals(src) }
    }

    /** Verifies a content pack carried in a broadcast bundle. */
    fun verify(bundle: Bundle, body: JsonElement, installedVersion: Int, trusted: List<ByteArray>): Result {
        if (!fromTrusted(bundle, trusted)) return Result.Refused("source is not a trusted key")
        return try {
            val signed = body.jsonObject
            val pack = signed["pack"]!!.jsonObject
            val sig = unhex(signed["sig"]!!.jsonPrimitive.content)
            if (pack["name"]?.jsonPrimitive?.content != NAME) return Result.Refused("wrong pack name")
            val version = pack["version"]!!.jsonPrimitive.int
            if (version < 1) return Result.Refused("bad version")
            if (!trustedSigner(trusted, ("collapse-pack-v1|" + canonical(pack)).toByteArray(), sig)) return Result.Refused("bad signature")
            if (version <= installedVersion) return Result.Refused("not newer than installed version (rollback refused)")
            val quests = pack["quests"]?.jsonArray ?: JsonArray(emptyList())
            if (quests.size > 100) return Result.Refused("too many quests")
            val ids = HashSet<String>()
            for (q in quests) {
                val id = q.jsonObject["id"]?.jsonPrimitive?.content ?: return Result.Refused("quest without id")
                if (!ids.add(id)) return Result.Refused("duplicate quest $id")
                validateQuest(q.jsonObject)?.let { return Result.Refused("$it in $id") }
            }
            val screens = pack["screens"]?.jsonArray ?: JsonArray(emptyList())
            if (screens.size > 50) return Result.Refused("too many screens")
            val sids = HashSet<String>()
            for (s in screens) {
                val id = s.jsonObject["id"]?.jsonPrimitive?.content ?: return Result.Refused("screen without id")
                if (!sids.add(id)) return Result.Refused("duplicate screen $id")
                validateScreen(s.jsonObject)?.let { return Result.Refused("$it in screen $id") }
            }
            val videos = pack["videos"]?.jsonArray ?: JsonArray(emptyList())
            if (videos.size > 20) return Result.Refused("too many videos")
            for (v in videos) validateVideo(v.jsonObject)?.let { return Result.Refused("$it in video") }
            if (quests.isEmpty() && screens.isEmpty() && videos.isEmpty()) return Result.Refused("empty pack")
            Result.Ok(version, pack)
        } catch (_: Exception) {
            Result.Refused("malformed pack")
        }
    }

    /** Verifies a keyring: the new trusted set, signed by a currently trusted key, with a newer version. */
    fun verifyKeyring(bundle: Bundle, body: JsonElement, installedVersion: Int, trusted: List<ByteArray>): KeyringResult {
        if (!fromTrusted(bundle, trusted)) return KeyringResult.Refused("source is not a trusted key")
        return try {
            val signed = body.jsonObject
            val kr = signed["keyring"]!!.jsonObject
            val sig = unhex(signed["sig"]!!.jsonPrimitive.content)
            if (kr["name"]?.jsonPrimitive?.content != KEYRING_NAME) return KeyringResult.Refused("wrong keyring name")
            val version = kr["version"]!!.jsonPrimitive.int
            if (version <= installedVersion) return KeyringResult.Refused("not newer than installed keyring (rollback refused)")
            val keys = kr["keys"]!!.jsonArray.map { it.jsonPrimitive.content }
            if (keys.isEmpty() || keys.size > MAX_KEYS) return KeyringResult.Refused("keyring must hold 1 to $MAX_KEYS keys")
            if (keys.any { it.length != 64 || !it.all { c -> c in '0'..'9' || c in 'a'..'f' } }) return KeyringResult.Refused("bad key")
            if (keys.toSet().size != keys.size) return KeyringResult.Refused("duplicate key")
            if (!trustedSigner(trusted, ("collapse-keyring-v1|" + canonical(kr)).toByteArray(), sig)) return KeyringResult.Refused("not signed by a trusted key")
            KeyringResult.Ok(version, keys)
        } catch (_: Exception) {
            KeyringResult.Refused("malformed keyring")
        }
    }

    private val ID = Regex("^[a-z0-9-]{1,40}$")
    private val TYPES = setOf("locate_prove", "build_make", "decode_act", "interview", "relay")

    internal fun validateQuest(q: JsonObject): String? {
        if (!ID.matches(q["id"]?.jsonPrimitive?.content ?: "")) return "bad quest id"
        if (q["type"]?.jsonPrimitive?.content !in TYPES) return "bad type"
        val title = q["title"]?.jsonPrimitive?.content ?: ""
        val desc = q["description"]?.jsonPrimitive?.content ?: ""
        if (title.isEmpty() || title.length > 80 || desc.isEmpty() || desc.length > 500) return "bad text"
        val pts = q["rewardPoints"]!!.jsonPrimitive.int
        val coins = q["rewardCoins"]!!.jsonPrimitive.int
        if (pts !in 0..10000 || coins !in 0..1000) return "bad reward"
        val stages = q["stages"]!!.jsonArray
        if (stages.isEmpty() || stages.size > 8) return "need 1-8 stages"
        val seen = HashSet<String>()
        for (s in stages) {
            val o = s.jsonObject
            val sid = o["id"]!!.jsonPrimitive.content
            if (!ID.matches(sid) || !seen.add(sid)) return "bad stage id"
            when (o["kind"]!!.jsonPrimitive.content) {
                "visit" -> {
                    val lat = o["lat"]!!.jsonPrimitive.double
                    val lng = o["lng"]!!.jsonPrimitive.double
                    val r = o["radiusM"]!!.jsonPrimitive.double
                    if (lat !in -90.0..90.0 || lng !in -180.0..180.0 || r !in 10.0..1000.0) return "bad visit location"
                }
                "record" -> Unit
                else -> return "bad stage kind"
            }
            val text = o["text"]?.jsonPrimitive?.content ?: ""
            if (text.isEmpty() || text.length > 200) return "bad stage text"
        }
        return null
    }

    /** Parses a pack's video manifests. Entries that fail validation are dropped by VideoStore.register. */
    fun videoManifests(pack: JsonObject): List<VideoManifest> =
        (pack["videos"]?.jsonArray ?: JsonArray(emptyList())).mapNotNull { el ->
            try {
                val v = el.jsonObject
                VideoManifest(
                    id = v["id"]!!.jsonPrimitive.content,
                    title = v["title"]!!.jsonPrimitive.content,
                    size = v["size"]!!.jsonPrimitive.long,
                    sha256 = v["sha256"]!!.jsonPrimitive.content,
                    chunkSize = v["chunkSize"]!!.jsonPrimitive.int,
                    chunkHashes = v["chunkHashes"]!!.jsonArray.map { it.jsonPrimitive.content },
                )
            } catch (_: Exception) { null }
        }

    internal fun validateVideo(v: JsonObject): String? {
        val m = try {
            VideoManifest(
                id = v["id"]!!.jsonPrimitive.content,
                title = v["title"]!!.jsonPrimitive.content,
                size = v["size"]!!.jsonPrimitive.long,
                sha256 = v["sha256"]!!.jsonPrimitive.content,
                chunkSize = v["chunkSize"]!!.jsonPrimitive.int,
                chunkHashes = v["chunkHashes"]!!.jsonArray.map { it.jsonPrimitive.content },
            )
        } catch (_: Exception) {
            return "malformed video"
        }
        return VideoStore.validate(m)
    }

    /** A screen is a list of content blocks drawn by the app. Packs cannot ship code, only these block types. */
    internal fun validateScreen(s: JsonObject): String? {
        if (!ID.matches(s["id"]?.jsonPrimitive?.content ?: "")) return "bad screen id"
        val title = s["title"]?.jsonPrimitive?.content ?: ""
        if (title.isEmpty() || title.length > 80) return "bad screen title"
        val blocks = s["blocks"]?.jsonArray ?: return "screen has no blocks"
        if (blocks.isEmpty() || blocks.size > 20) return "need 1-20 blocks"
        for (b in blocks) {
            val o = b.jsonObject
            when (o["type"]?.jsonPrimitive?.content) {
                "text" -> if ((o["text"]?.jsonPrimitive?.content ?: "").let { it.isEmpty() || it.length > 500 }) return "bad text block"
                "list" -> {
                    val items = o["items"]?.jsonArray ?: return "bad list block"
                    if (items.size > 20 || items.any { (it.jsonPrimitive.content).let { t -> t.isEmpty() || t.length > 200 } }) return "bad list block"
                }
                "quest" -> if (!ID.matches(o["questId"]?.jsonPrimitive?.content ?: "")) return "bad quest link"
                "video" -> if (!ID.matches(o["videoId"]?.jsonPrimitive?.content ?: "")) return "bad video link"
                "link" -> {
                    if (!ID.matches(o["screenId"]?.jsonPrimitive?.content ?: "")) return "bad screen link"
                    val label = o["label"]?.jsonPrimitive?.content ?: ""
                    if (label.isEmpty() || label.length > 60) return "bad link label"
                }
                else -> return "unknown block type"
            }
        }
        return null
    }
}
