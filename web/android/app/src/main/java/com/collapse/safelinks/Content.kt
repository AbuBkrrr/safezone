package com.collapse.safelinks

import com.collapse.safelinks.dtn.hex

/** Pinned maintainer public key. Packs signed by any other key are refused. */
object Content {
    const val MAINTAINER_PUB_HEX = "4e203ec98eedfbd9251f35a817d66ddbd6acf5d6579e7a5db6be06d54ea96a1d"
    val MAINTAINER_PUB: ByteArray = com.collapse.safelinks.dtn.unhex(MAINTAINER_PUB_HEX)
    /** Quest ids the static build has pages for. Packs can change these but not add new ones. */
    val BASE_IDS = setOf("q47", "q48", "q49")
}
