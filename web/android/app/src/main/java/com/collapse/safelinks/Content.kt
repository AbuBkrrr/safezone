package com.collapse.safelinks

import com.collapse.safelinks.dtn.hex

/** Pinned maintainer public key. Packs signed by any other key are refused. */
object Content {
    const val MAINTAINER_PUB_HEX = "4e203ec98eedfbd9251f35a817d66ddbd6acf5d6579e7a5db6be06d54ea96a1d"
    /** Keys built into the APK. Later keyrings, signed by these keys, can replace them (rotation). */
    val BUILTIN_KEYS = listOf(MAINTAINER_PUB_HEX)
}
