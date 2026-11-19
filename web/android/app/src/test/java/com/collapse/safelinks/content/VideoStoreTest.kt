package com.collapse.safelinks.content

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files

class VideoStoreTest {
    private val data = ByteArray(40_000).also { java.util.Random(3).nextBytes(it) }
    private val cs = 16384
    private val hashes = (0 until 3).map { i -> VideoStore.sha256Hex(data.copyOfRange(i * cs, minOf(data.size, (i + 1) * cs))) }
    private val manifest = VideoManifest("clip-2", "Clip", data.size.toLong(), VideoStore.sha256Hex(data), cs, hashes)
    private fun store() = VideoStore(Files.createTempDirectory("vs").toFile()).also { it.register(listOf(manifest)) }
    private fun piece(i: Int) = data.copyOfRange(i * cs, minOf(data.size, (i + 1) * cs))

    @Test fun manifestRulesAreEnforced() {
        assertNull(VideoStore.validate(manifest))
        assertNotNull(VideoStore.validate(manifest.copy(chunkHashes = hashes.dropLast(1))))
        assertNotNull(VideoStore.validate(manifest.copy(size = VideoStore.MAX_SIZE + 1)))
        assertNotNull(VideoStore.validate(manifest.copy(chunkSize = 100)))
        assertNotNull(VideoStore.validate(manifest.copy(id = "Bad Id")))
    }

    @Test fun piecesMustMatchTheirSignedHash() {
        val s = store()
        assertFalse(s.putChunk("clip-2", 0, ByteArray(cs) { 1 }))   // right size, wrong content
        assertFalse(s.putChunk("clip-2", 0, piece(1)))               // wrong piece for this index
        assertTrue(s.putChunk("clip-2", 0, piece(0)))
        assertEquals(listOf(0), s.have("clip-2"))
    }

    @Test fun completeVideoIsInstalledAndServesEveryPiece() {
        val s = store()
        for (i in 0 until 3) assertTrue(s.putChunk("clip-2", i, piece(i)))
        assertTrue(s.isInstalled("clip-2"))
        assertEquals(listOf(0, 1, 2), s.have("clip-2"))
        assertArrayEquals(piece(2), s.readChunk("clip-2", 2))
    }

    @Test fun wholeFileHashMismatchLeavesNothingInstalled() {
        val bad = manifest.copy(sha256 = "00".repeat(32))
        val s = VideoStore(Files.createTempDirectory("vs").toFile()).also { it.register(listOf(bad)) }
        val parts = (0 until 3).map { piece(it) }
        for (i in 0 until 3) s.putChunk("clip-2", i, parts[i])
        assertFalse(s.isInstalled("clip-2"))
        assertEquals(emptyList<Int>(), s.have("clip-2"))
    }

    @Test fun seedingRejectsAFileThatDoesNotMatch() {
        val s = store()
        val wrong = File.createTempFile("wrong", ".mp4").also { it.writeBytes(ByteArray(40_000)) }
        assertFalse(s.seedFile("clip-2", wrong))
        assertFalse(s.isInstalled("clip-2"))
    }
}
