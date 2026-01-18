# Overview

Encrypted data is passed as an `Enc<Owner, T>` generic type, where `Owner` specifies who can decrypt the data (either `Shared` or `Mxe`), and `T` is the underlying data type being encrypted. In the case of `Mxe`, the nodes collectively can decrypt the data under dishonest majority assumptions, whereas if the `Owner` is `Shared`, then the data was encrypted using a shared secret between the client and the MXE. Underneath the hood, this generic wrapper type contains the encrypted data, as well as the public key (only for `Shared` owner) and nonce used to encrypt the data.

Encrypted data can be decrypted globally or selectively to a given user. For global decryption, you can call `reveal` method on any variable of [supported data type](/developers/arcis/types). Read more about how we enable this using re-encryption (aka sealing) in Arcium [here](/developers/encryption/sealing).

Private inputs are encrypted using the arithmetization-oriented symmetric [Rescue cipher](https://eprint.iacr.org/2019/426). Prior to the encryption, a [x25519](https://www.rfc-editor.org/rfc/rfc7748.html#page-7) elliptic curve Diffie-Hellman key exchange is performed between the client and the cluster to derive a common shared secret. The Rescue key is derived by hashing the shared secret with the [Rescue-Prime](https://eprint.iacr.org/2020/1143.pdf) hash function, as described in [Section 4](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-56Cr2.pdf), Option 1.  This increases the min-entropy of the key.\
Note:

1. Since the x25519 key exchange natively returns shared secrets in the finite field with $p = 2^{255} - 19$ elements, we implemented Rescue over the field $\mathbb{F}_{p}$. States in the context of Rescue are elements of the $m$-dimensional vector space $\mathbb{F}_p^m$, i.e., the Rescue cipher transforms vectors of size $m$ to vectors of the same size.
2. The security level $s$ of the cipher is set to 128 bits.
3. We use the Rescue block cipher in [Counter (CTR) mode](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38a.pdf) (see Section 6.5), with fixed $m = 5$. The choice $m = 5$ is motivated by the fact that it is the smallest value that attains the minimum of recommended rounds (10), given the fixed finite field and security level. The `counter`s are of the form `[nonce, i, 0, 0, 0]`, where `nonce` are 16 random bytes provided by the user.
4. The hash function used for key derivation is Rescue-Prime over $\mathbb{F}_{2^{255}-19}$, with `rate = 7` and `capacity = 5` (i.e., $m = 12$) and output truncated to 5 field elements. The target security level $s$ is set to 256. According to [Section 2.2](https://eprint.iacr.org/2020/1143.pdf), this offers 256 bits of security against collision, preimage and second-preimage attacks for any field of size at least 102 bits.

The decryption of `input_enc: Enc<Owner, T>` can conveniently be obtained by calling `input_enc.to_arcis()` (the nodes do not learn `input`, they simply convert the ciphertext to secret-shares of `input` by running the Rescue decryption circuit in MPC). If the owner is `Shared`, the MXE and the client perform a key exchange first. Similarly, `owner.from_arcis(output)` encrypts the secret-shared `output` by running the Rescue encryption circuit in MPC.\
Note:

1. After decrypting the user-provided inputs, the MXE increments the `nonce` by 1 and uses it for encrypting the outputs. For the forthcoming interaction with the MXE, a new `nonce` must be provided.
2. The performance will benefit from reducing the number of calls to `owner.from_arcis(..)` (per owner). Ideally, put all data encrypted to `owner` in one struct.


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
