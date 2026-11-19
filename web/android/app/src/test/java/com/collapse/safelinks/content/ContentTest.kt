package com.collapse.safelinks.content

import com.collapse.safelinks.dtn.*
import com.collapse.safelinks.transport.ByteQueue
import com.collapse.safelinks.transport.GattSync
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ContentTest {
    private val now = 1_800_000_000L

    private fun quest(id: String) = buildJsonObject {
        put("id", id); put("type", "locate_prove"); put("title", "Quest $id"); put("description", "Do it")
        put("rewardPoints", 100); put("rewardCoins", 1)
        put("stages", buildJsonArray { add(buildJsonObject { put("id", "s1"); put("kind", "record"); put("text", "Record") }) })
    }

    private fun screen(id: String, block: JsonObject = buildJsonObject { put("type", "text"); put("text", "Hello") }) = buildJsonObject {
        put("id", id); put("title", "News $id"); put("blocks", buildJsonArray { add(block) })
    }

    private fun signedPack(signer: Identity, version: Int, quests: List<JsonObject>, screens: List<JsonObject> = emptyList()): JsonObject {
        val pack = buildJsonObject {
            put("name", Packs.NAME); put("version", version); put("issued", now)
            put("quests", JsonArray(quests)); put("screens", JsonArray(screens))
        }
        val sig = hex(signer.sign(("collapse-pack-v1|" + canonical(pack)).toByteArray()))
        return buildJsonObject { put("pack", pack); put("sig", sig) }
    }

    private fun signedKeyring(signer: Identity, version: Int, keys: List<String>): JsonObject {
        val kr = buildJsonObject { put("name", Packs.KEYRING_NAME); put("version", version); put("keys", JsonArray(keys.map { JsonPrimitive(it) })) }
        val sig = hex(signer.sign(("collapse-keyring-v1|" + canonical(kr)).toByteArray()))
        return buildJsonObject { put("keyring", kr); put("sig", sig) }
    }

    private fun broadcast(from: Identity, kind: String, body: JsonObject) =
        makeBundle(from, Dtn.BROADCAST, kind, body, now, 7 * 24 * 3600)

    @Test fun packAddsNewQuestAndScreen() {
        val m = Identity.generate()
        val body = signedPack(m, 1, listOf(quest("brand-new")), listOf(screen("news-1")))
        val r = Packs.verify(broadcast(m, Packs.KIND, body), body, 0, listOf(m.signPub))
        assertTrue("$r", r is Packs.Result.Ok)
    }

    @Test fun packWithUnknownBlockTypeIsRefused() {
        val m = Identity.generate()
        val bad = screen("news-2", buildJsonObject { put("type", "script"); put("code", "alert(1)") })
        val body = signedPack(m, 1, listOf(quest("q1")), listOf(bad))
        assertTrue(Packs.verify(broadcast(m, Packs.KIND, body), body, 0, listOf(m.signPub)) is Packs.Result.Refused)
    }

    @Test fun packFromUntrustedKeyIsRefused() {
        val m = Identity.generate(); val evil = Identity.generate()
        val body = signedPack(evil, 9, listOf(quest("q1")))
        assertTrue(Packs.verify(broadcast(evil, Packs.KIND, body), body, 0, listOf(m.signPub)) is Packs.Result.Refused)
    }

    @Test fun packRollbackRefused() {
        val m = Identity.generate()
        val body = signedPack(m, 3, listOf(quest("q1")))
        assertTrue(Packs.verify(broadcast(m, Packs.KIND, body), body, 3, listOf(m.signPub)) is Packs.Result.Refused)
    }

    @Test fun rotationReplacesTheTrustedSetAndRevokesTheOldKey() {
        val oldKey = Identity.generate(); val newKey = Identity.generate()
        val kr1 = signedKeyring(oldKey, 1, listOf(hex(oldKey.signPub), hex(newKey.signPub)))
        val r1 = Packs.verifyKeyring(broadcast(oldKey, Packs.KEYRING_KIND, kr1), kr1, 0, listOf(oldKey.signPub))
        assertTrue("$r1", r1 is Packs.KeyringResult.Ok)
        val kr2 = signedKeyring(oldKey, 2, listOf(hex(newKey.signPub)))
        val r2 = Packs.verifyKeyring(broadcast(oldKey, Packs.KEYRING_KIND, kr2), kr2, 1, listOf(oldKey.signPub, newKey.signPub))
        assertTrue("$r2", r2 is Packs.KeyringResult.Ok)
        val trusted = listOf(newKey.signPub)
        val oldPack = signedPack(oldKey, 5, listOf(quest("q1")))
        assertTrue(Packs.verify(broadcast(oldKey, Packs.KIND, oldPack), oldPack, 0, trusted) is Packs.Result.Refused)
        val newPack = signedPack(newKey, 5, listOf(quest("q1")))
        assertTrue(Packs.verify(broadcast(newKey, Packs.KIND, newPack), newPack, 0, trusted) is Packs.Result.Ok)
    }

    @Test fun keyringFromUntrustedKeyOrReplayedVersionIsRefused() {
        val m = Identity.generate(); val evil = Identity.generate()
        val forged = signedKeyring(evil, 7, listOf(hex(evil.signPub)))
        assertTrue(Packs.verifyKeyring(broadcast(evil, Packs.KEYRING_KIND, forged), forged, 0, listOf(m.signPub)) is Packs.KeyringResult.Refused)
        val old = signedKeyring(m, 2, listOf(hex(m.signPub)))
        assertTrue(Packs.verifyKeyring(broadcast(m, Packs.KEYRING_KIND, old), old, 2, listOf(m.signPub)) is Packs.KeyringResult.Refused)
    }

    @Test fun gattRolesAreDecidedOnceByDeviceId() {
        val a = byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8); val b = byteArrayOf(1, 2, 3, 4, 5, 6, 7, 9)
        assertTrue(GattSync.initiates(a, b))
        assertFalse(GattSync.initiates(b, a))
        assertFalse(GattSync.initiates(a, a))
    }

    @Test fun byteQueueHandsBytesAcrossThreadsAndEnds() {
        val q = ByteQueue()
        val t = Thread { q.output.write("hello ".toByteArray()); q.output.write("world".toByteArray()); q.close() }
        t.start()
        val text = q.input.readBytes().toString(Charsets.UTF_8)
        t.join()
        assertEquals("hello world", text)
    }

    /** Interop: a v6 pack (new quest plus screen) and a keyring, both signed by the web maintainer tool, verify here. */
    @Test fun verifiesWebBuiltPackAndKeyring() {
        val maintainer = com.collapse.safelinks.dtn.unhex(com.collapse.safelinks.Content.MAINTAINER_PUB_HEX)
        val pb = Bundle.fromJson(Json.parseToJsonElement(javaClass.getResource("/pack-v6-bundle.json")!!.readText()).jsonObject)
        assertTrue(verifyBundle(pb, pb.created + 60))
        val pbody = Json.parseToJsonElement(String(unhex(pb.body))).jsonObject["body"]!!
        val pr = Packs.verify(pb, pbody, 5, listOf(maintainer))
        assertTrue("$pr", pr is Packs.Result.Ok)
        val kb = Bundle.fromJson(Json.parseToJsonElement(javaClass.getResource("/keyring-v1-bundle.json")!!.readText()).jsonObject)
        assertTrue(verifyBundle(kb, kb.created + 60))
        val kbody = Json.parseToJsonElement(String(unhex(kb.body))).jsonObject["body"]!!
        val kr = Packs.verifyKeyring(kb, kbody, 0, listOf(maintainer))
        assertTrue("$kr", kr is Packs.KeyringResult.Ok)
    }
}
