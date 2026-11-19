package com.collapse.safelinks.content

import com.collapse.safelinks.dtn.hex
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest

/** A video's signed manifest, carried inside a content pack. */
data class VideoManifest(
    val id: String,
    val title: String,
    val size: Long,
    val sha256: String,
    val chunkSize: Int,
    val chunkHashes: List<String>,
) {
    val chunkCount: Int get() = ((size + chunkSize - 1) / chunkSize).toInt()
    fun chunkLen(i: Int): Int = if (i == chunkCount - 1) (size - i.toLong() * chunkSize).toInt() else chunkSize
}

/**
 * Video files on this device. Pieces arrive from other phones during sync, each checked against the
 * signed chunk hash. When all pieces are present the whole file is checked against the signed hash and
 * installed as <id>.mp4. Installed videos can still serve any piece, so every device helps spread them.
 */
class VideoStore(private val dir: File) {
    companion object {
        const val MAX_SIZE = 50L * 1024 * 1024
        const val MIN_CHUNK = 4096
        const val MAX_CHUNK = 65536
        private val HEX64 = Regex("^[0-9a-f]{64}$")

        fun sha256Hex(b: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(b))

        /** Validates a manifest from a pack. Returns the reason on failure. */
        fun validate(m: VideoManifest): String? {
            if (!Regex("^[a-z0-9-]{1,40}$").matches(m.id)) return "bad video id"
            if (m.title.isEmpty() || m.title.length > 80) return "bad video title"
            if (m.size !in 1..MAX_SIZE) return "video size out of range"
            if (!HEX64.matches(m.sha256)) return "bad video hash"
            if (m.chunkSize !in MIN_CHUNK..MAX_CHUNK) return "bad chunk size"
            if (m.chunkHashes.size != m.chunkCount || m.chunkHashes.any { !HEX64.matches(it) }) return "bad chunk hashes"
            return null
        }
    }

    private val manifests = LinkedHashMap<String, VideoManifest>()

    init { dir.mkdirs() }

    private fun mp4(id: String) = File(dir, "$id.mp4")
    private fun partDir(id: String) = File(dir, "$id.parts")

    /** Replaces the set of known manifests with the ones from the newest pack. */
    @Synchronized fun register(list: List<VideoManifest>) {
        manifests.clear()
        for (m in list) if (validate(m) == null) manifests[m.id] = m
    }

    @Synchronized fun manifests(): List<VideoManifest> = manifests.values.toList()

    @Synchronized fun isInstalled(id: String): Boolean = mp4(id).exists()

    @Synchronized fun installedPath(id: String): String? = mp4(id).takeIf { it.exists() }?.absolutePath

    /** Piece indices this device can send for the video. */
    @Synchronized fun have(id: String): List<Int> {
        val m = manifests[id] ?: return emptyList()
        if (mp4(id).exists()) return (0 until m.chunkCount).toList()
        return partDir(id).listFiles()?.mapNotNull { it.name.toIntOrNull() }?.filter { it in 0 until m.chunkCount }?.sorted() ?: emptyList()
    }

    @Synchronized fun readChunk(id: String, i: Int): ByteArray? {
        val m = manifests[id] ?: return null
        if (i !in 0 until m.chunkCount) return null
        if (mp4(id).exists()) {
            RandomAccessFile(mp4(id), "r").use { raf ->
                val buf = ByteArray(m.chunkLen(i))
                raf.seek(i.toLong() * m.chunkSize)
                raf.readFully(buf)
                return buf
            }
        }
        val part = File(partDir(id), "$i")
        return if (part.exists()) part.readBytes() else null
    }

    /** Stores a piece only if it matches its signed hash. Assembles and checks the whole video when complete. */
    @Synchronized fun putChunk(id: String, i: Int, data: ByteArray): Boolean {
        val m = manifests[id] ?: return false
        if (i !in 0 until m.chunkCount || mp4(id).exists()) return false
        if (data.size != m.chunkLen(i) || sha256Hex(data) != m.chunkHashes[i]) return false
        partDir(id).mkdirs()
        File(partDir(id), "$i").writeBytes(data)
        if (have(id).size == m.chunkCount) assemble(m)
        return true
    }

    private fun assemble(m: VideoManifest) {
        val tmp = File(dir, "${m.id}.tmp")
        val md = MessageDigest.getInstance("SHA-256")
        tmp.outputStream().use { out ->
            for (i in 0 until m.chunkCount) {
                val b = File(partDir(m.id), "$i").readBytes()
                md.update(b)
                out.write(b)
            }
        }
        if (hex(md.digest()) == m.sha256) {
            tmp.renameTo(mp4(m.id))
            partDir(m.id).deleteRecursively()
        } else {
            tmp.delete()
            partDir(m.id).deleteRecursively()
        }
    }

    /** Debug seeding: installs a complete file after checking it against the manifest. */
    @Synchronized fun seedFile(id: String, file: File): Boolean {
        val m = manifests[id] ?: return false
        val bytes = file.readBytes()
        if (bytes.size.toLong() != m.size || sha256Hex(bytes) != m.sha256) return false
        file.copyTo(mp4(id), overwrite = true)
        return true
    }
}
