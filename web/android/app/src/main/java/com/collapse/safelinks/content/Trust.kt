package com.collapse.safelinks.content

import com.collapse.safelinks.Content
import com.collapse.safelinks.dtn.unhex

/** The maintainer keys this device trusts. Starts from the keys built into the APK, then follows signed keyrings. */
class Trust(private val loader: () -> Pair<Int, List<String>>?) {
    fun version(): Int = current().first

    fun current(): Pair<Int, List<ByteArray>> {
        val stored = loader()
        val (v, keys) = stored ?: (0 to Content.BUILTIN_KEYS)
        return v to keys.map { unhex(it) }
    }
}
