package com.collapse.safelinks.dtn

import com.collapse.safelinks.content.Packs
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class DtnTest {
    private val now = 1_800_000_000L
    private val h = 3600L
    private fun msg(text: String) = buildJsonObject { put("text", text) }

    private fun sync(a: DtnStore, ai: Identity, b: DtnStore, bi: Identity, t: Long): Pair<List<Delivered>, List<Delivered>> {
        val sa = a.summaryIds(t).toSet() to a.summaryAcks().toSet()
        val sb = b.summaryIds(t).toSet() to b.summaryAcks().toSet()
        val toB = a.plan(sb.first, sb.second, bi.address, t)
        val toA = b.plan(sa.first, sa.second, ai.address, t)
        return b.receive(toB, bi, t) { true } to a.receive(toA, ai, t) { true }
    }

    @Test fun roundTripOnlyToRecipient() {
        val a = Identity.generate(); val b = Identity.generate(); val c = Identity.generate()
        val m = makeBundle(a, b.address, "msg", msg("meet at the wall"), now, 6 * h)
        assertTrue(verifyBundle(m, now))
        assertEquals("meet at the wall", openBundle(m, b)!!.body.jsonObject["text"]!!.jsonPrimitive.content)
        assertNull(openBundle(m, c))
    }

    @Test fun relayCannotReadContent() {
        val a = Identity.generate(); val b = Identity.generate()
        val m = makeBundle(a, b.address, "msg", msg("secret-phrase-xyz"), now, h)
        assertFalse(m.toJson().toString().contains("secret-phrase-xyz"))
    }

    @Test fun tamperingIsDetected() {
        val a = Identity.generate(); val b = Identity.generate()
        val m = makeBundle(a, b.address, "msg", msg("x"), now, h)
        assertFalse(verifyBundle(m.copy(ttl = m.ttl * 10), now))
        assertFalse(verifyBundle(m.copy(dst = Identity.generate().address), now))
        assertFalse(verifyBundle(m.copy(body = "00" + m.body.substring(2)), now))
    }

    @Test fun expiresAfterTtl() {
        val a = Identity.generate(); val b = Identity.generate()
        val m = makeBundle(a, b.address, "msg", msg("x"), now, h)
        assertTrue(verifyBundle(m, now + h - 1))
        assertFalse(verifyBundle(m, now + h))
    }

    @Test fun deliversViaRelayAndPurgesAfterAck() {
        val a = Identity.generate(); val b = Identity.generate(); val c = Identity.generate()
        val sa = DtnStore(); val sb = DtnStore(); val sc = DtnStore()
        val m = makeBundle(a, c.address, "msg", msg("via B"), now, 6 * h)
        sa.bundles[m.id] = m
        sync(sa, a, sb, b, now + 60)
        assertNotNull(sb.bundles[m.id])
        sync(sb, b, sc, c, now + 120)
        assertEquals(listOf("via B"), sc.inbox.map { it.body.jsonObject["text"]!!.jsonPrimitive.content })
        // A's copy is still in transit until the ack reaches it.
        sync(sc, c, sa, a, now + 180)
        assertNull(sa.bundles[m.id])
    }

    @Test fun sprayKeepsTotalCopies() {
        val a = Identity.generate(); val b = Identity.generate(); val x = Identity.generate()
        val sa = DtnStore(); val sb = DtnStore(); val sx = DtnStore()
        val m = makeBundle(a, Identity.generate().address, "msg", msg("s"), now, 6 * h)
        sa.bundles[m.id] = m
        sync(sa, a, sb, b, now + 1)
        sync(sa, a, sx, x, now + 2)
        val total = listOf(sa, sb, sx).sumOf { it.bundles[m.id]?.copies ?: 0 }
        assertEquals(Dtn.SPRAY, total)
    }

    @Test fun forgedAckIsRejected() {
        val b = Identity.generate(); val c = Identity.generate()
        val real = makeAck(c, "abc", now)
        assertTrue(verifyAck(real))
        assertFalse(verifyAck(real.copy(dst = b.address)))
    }

    @Test fun storeStaysWithinCap() {
        val a = Identity.generate(); val b = Identity.generate()
        val s = DtnStore()
        for (i in 0 until Dtn.MAX_BUNDLES + 25) {
            val m = makeBundle(a, b.address, "msg", msg("$i"), now + i, 6 * h)
            s.bundles[m.id] = m
        }
        s.prune(now + Dtn.MAX_BUNDLES + 30)
        assertEquals(Dtn.MAX_BUNDLES, s.bundles.size)
    }

    @Test fun storeRoundTripsThroughJson() {
        val a = Identity.generate(); val b = Identity.generate()
        val s = DtnStore()
        val m = makeBundle(a, b.address, "msg", msg("persist me"), now, h)
        s.bundles[m.id] = m
        val back = DtnStore.fromJson(s.toJson())
        assertEquals(m, back.bundles[m.id])
    }

    /** Interop: a maintainer pack broadcast created by the web build must verify here. */
    @Test fun verifiesWebBuildMaintainerPack() {
        val text = javaClass.getResource("/pack-v5-bundle.json")!!.readText()
        val o = Json.parseToJsonElement(text).jsonObject
        val bundle = Bundle.fromJson(o)
        assertTrue("web-built bundle header must verify", verifyBundle(bundle, bundle.created + 60))
        val body = Json.parseToJsonElement(String(unhex(bundle.body))).jsonObject
        val maintainer = unhex("4e203ec98eedfbd9251f35a817d66ddbd6acf5d6579e7a5db6be06d54ea96a1d")
        val r = Packs.verify(bundle, body["body"]!!, installedVersion = 0, trusted = listOf(maintainer))
        assertTrue("pack should install: $r", r is Packs.Result.Ok)
        assertEquals(5, (r as Packs.Result.Ok).version)
        // Rollback and tampering are refused.
        assertTrue(Packs.verify(bundle, body["body"]!!, 5, listOf(maintainer)) is Packs.Result.Refused)
    }
}
