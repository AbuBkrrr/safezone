package com.collapse.safelinks

import com.collapse.safelinks.dtn.*
import kotlinx.serialization.json.*
import java.io.File

/**
 * App-private storage. Every file is wrapped by KeyVault (Android Keystore master key).
 * Plain files from earlier builds are migrated on first read, then removed.
 */
class Storage(private val dir: File) {
    private val idFile = File(dir, "identity.bin")
    private val storeFile = File(dir, "dtn.bin")
    private val packFile = File(dir, "pack.bin")
    private val keyringFile = File(dir, "keyring.bin")

    private fun readWrapped(f: File): String? {
        if (!f.exists()) return null
        return String(KeyVault.unwrap(f.readBytes()), Charsets.UTF_8)
    }

    @Synchronized private fun writeWrapped(f: File, text: String) {
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeBytes(KeyVault.wrap(text.toByteArray(Charsets.UTF_8)))
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    /** Migrates a plaintext file from an earlier build, if one exists. */
    private fun migrate(old: String, to: File, transform: (String) -> String = { it }) {
        val f = File(dir, old)
        if (f.exists() && !to.exists()) {
            writeWrapped(to, transform(f.readText()))
        }
        if (f.exists()) f.delete()
    }

    fun identity(): Identity {
        migrate("identity.json", idFile)
        val text = readWrapped(idFile)
        if (text != null) {
            val o = Json.parseToJsonElement(text).jsonObject
            return Identity(unhex(o.str("signSeed")), unhex(o.str("boxSeed")))
        }
        val id = Identity.generate()
        writeWrapped(idFile, buildJsonObject { put("signSeed", hex(id.signSeed)); put("boxSeed", hex(id.boxSeed)) }.toString())
        return id
    }

    fun loadStore(): DtnStore {
        migrate("dtn.json", storeFile)
        val text = readWrapped(storeFile) ?: return DtnStore()
        return DtnStore.fromJson(Json.parseToJsonElement(text).jsonObject)
    }

    fun saveStore(s: DtnStore) = writeWrapped(storeFile, s.toJson().toString())

    /** Installed pack: version and the full pack object (quests and screens). */
    fun loadPack(): Pair<Int, JsonObject?> {
        migrate("pack.json", packFile)
        val text = readWrapped(packFile) ?: return 0 to null
        val o = Json.parseToJsonElement(text).jsonObject
        return o.long("version").toInt() to o["pack"]!!.jsonObject
    }

    fun savePack(version: Int, pack: JsonObject) =
        writeWrapped(packFile, buildJsonObject { put("version", version); put("pack", pack) }.toString())

    /** Trusted maintainer keys, from the last accepted keyring. Null means the built-in keys apply. */
    fun loadKeyring(): Pair<Int, List<String>>? {
        migrate("keyring.json", keyringFile)
        val text = readWrapped(keyringFile) ?: return null
        val o = Json.parseToJsonElement(text).jsonObject
        return o.long("version").toInt() to o["keys"]!!.jsonArray.map { it.jsonPrimitive.content }
    }

    fun saveKeyring(version: Int, keys: List<String>) =
        writeWrapped(keyringFile, buildJsonObject { put("version", version); put("keys", JsonArray(keys.map { JsonPrimitive(it) })) }.toString())
}
