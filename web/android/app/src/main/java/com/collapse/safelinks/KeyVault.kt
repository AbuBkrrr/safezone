package com.collapse.safelinks

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Wraps every secret the app stores (identity seeds, message store, content) with an AES-256-GCM key
 * that never leaves Android Keystore. It is StrongBox-backed when the phone has a StrongBox chip.
 * Ed25519 and X25519 private keys cannot be held in Keystore on API 26-32, so they are unwrapped in
 * memory only while the app uses them.
 */
object KeyVault {
    private const val ALIAS = "collapse.master.v1"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val IV_LEN = 12
    private const val TAG_BITS = 128

    private fun masterKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        return try {
            if (Build.VERSION.SDK_INT >= 28) spec.setIsStrongBoxBacked(true)
            gen.init(spec.build())
            gen.generateKey()
        } catch (_: StrongBoxUnavailableException) {
            gen.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            gen.generateKey()
        }
    }

    /** Returns IV || ciphertext || tag. */
    fun wrap(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, masterKey())
        val iv = c.iv
        return iv + c.doFinal(plain)
    }

    fun unwrap(blob: ByteArray): ByteArray {
        require(blob.size > IV_LEN + TAG_BITS / 8) { "blob too short" }
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(TAG_BITS, blob.copyOfRange(0, IV_LEN)))
        return c.doFinal(blob.copyOfRange(IV_LEN, blob.size))
    }

    @Suppress("unused")
    private val rng = SecureRandom()
}
