package com.collapse.safelinks

import com.collapse.safelinks.dtn.*
import kotlinx.serialization.json.*
import java.io.File

/**
 * Device files: identity seeds, the DTN store, and the installed content pack.
 * Stored in app-private storage. Not encrypted yet: see the gaps list (no Android Keystore).
 */
class Storage(private val dir: File) {
    private val idFile = File(dir, "identity.json")
    private val storeFile = File(dir, "dtn.json")
    private val packFile = File(dir, "pack.json")

    fun identity(): Identity {
        if (idFile.exists()) {
            val o = Json.parseToJsonElement(idFile.readText()).jsonObject
            return Identity(unhex(o.str("signSeed")), unhex(o.str("boxSeed")))
        }
        val id = Identity.generate()
        idFile.writeText(buildJsonObject { put("signSeed", hex(id.signSeed)); put("boxSeed", hex(id.boxSeed)) }.toString())
        return id
    }

    fun loadStore(): DtnStore =
        if (storeFile.exists()) DtnStore.fromJson(Json.parseToJsonElement(storeFile.readText()).jsonObject) else DtnStore()

    @Synchronized fun saveStore(s: DtnStore) {
        val tmp = File(dir, "dtn.json.tmp")
        tmp.writeText(s.toJson().toString())
        tmp.renameTo(storeFile)
    }

    /** Installed pack: version and the pack object. */
    fun loadPack(): Pair<Int, JsonObject?> {
        if (!packFile.exists()) return 0 to null
        val o = Json.parseToJsonElement(packFile.readText()).jsonObject
        return o.long("version").toInt() to o["pack"]!!.jsonObject
    }

    fun savePack(version: Int, pack: JsonObject) {
        packFile.writeText(buildJsonObject { put("version", version); put("pack", pack) }.toString())
    }
}
