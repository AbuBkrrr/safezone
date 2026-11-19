package com.collapse.safelinks.content

import com.collapse.safelinks.dtn.Bundle
import com.collapse.safelinks.dtn.canonical
import com.collapse.safelinks.dtn.unhex
import com.collapse.safelinks.dtn.verifySig
import kotlinx.serialization.json.*

/**
 * Signed content packs, ported from web/lib/dtn/packs.ts. A pack is accepted only if its signature
 * checks against the pinned maintainer key, its version is newer than the installed one, and it
 * changes existing quests only.
 */
object Packs {
    const val NAME = "collapse-content"
    const val KIND = "pack"

    sealed class Result {
        data class Ok(val version: Int, val pack: JsonObject) : Result()
        data class Refused(val reason: String) : Result()
    }

    /** Verifies the pack carried in a broadcast bundle's body and source. */
    fun verify(
        bundle: Bundle,
        body: JsonElement,
        installedVersion: Int,
        baseIds: Set<String>,
        maintainerPub: ByteArray,
    ): Result {
        val src = unhex(bundle.src.substring(0, 64))
        if (!src.contentEquals(maintainerPub)) return Result.Refused("not from the maintainer")
        return try {
            val signed = body.jsonObject
            val pack = signed["pack"]!!.jsonObject
            val sig = unhex(signed["sig"]!!.jsonPrimitive.content)
            if (pack["name"]?.jsonPrimitive?.content != NAME) return Result.Refused("wrong pack name")
            val version = pack["version"]!!.jsonPrimitive.int
            if (version < 1) return Result.Refused("bad version")
            if (!verifySig(maintainerPub, ("collapse-pack-v1|" + canonical(pack)).toByteArray(), sig)) return Result.Refused("bad signature")
            if (version <= installedVersion) return Result.Refused("not newer than installed version (rollback refused)")
            val quests = pack["quests"]!!.jsonArray
            if (quests.isEmpty() || quests.size > 100) return Result.Refused("bad quest list")
            val seen = HashSet<String>()
            for (q in quests) {
                val id = q.jsonObject["id"]!!.jsonPrimitive.content
                if (id !in baseIds) return Result.Refused("unknown quest id $id (needs an app update)")
                if (!seen.add(id)) return Result.Refused("duplicate quest $id")
                validateQuest(q.jsonObject)?.let { return Result.Refused("$it in $id") }
            }
            Result.Ok(version, pack)
        } catch (_: Exception) {
            Result.Refused("malformed pack")
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
        }
        return null
    }
}
