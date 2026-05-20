# Arcium Rescue-Cipher / Rescue-Prime parameters

Extracted from `arcis-compiler` 0.9.6 source on 2026-05-20. Cite paths refer to
`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/arcis-compiler-0.9.6/`.

## Field

`BaseField` = $\mathbb{F}_p$ with $p = 2^{255} - 19$.

```
p = 57896044618658097711785492504343953926634992332820282019728792003956564819949
```

`src/utils/field/base_field.rs:335` (`PrimeFieldModulus`).

The cipher and hash both operate over this field. ECDH outputs (Montgomery
u-coordinates) are field elements.

## S-box exponent α

α is the smallest prime that does not divide $p - 1$. For
$p = 2^{255} - 19$:

- 2 | (p−1)  (p−1 is even)
- 3 | (p−1)
- **5 ∤ (p−1)** → **α = 5**

`src/utils/field.rs:169-177` (`find_alpha`).

α⁻¹ mod (p−1) is the inverse-S-box exponent. It is a ~255-bit integer; computed
via the deterministic algorithm in `find_alpha_inverse` (`src/utils/field.rs:180-194`).

## MDS matrix

Cauchy matrix on `x = [1, 2, ..., m]` and `y = [-1, -2, ..., -m]`. Entries:

```
M[i][j] = 1 / (x[i] - y[j]) = 1 / (i + j + 2)         (1-indexed, with i,j ∈ [0..m-1])
```

`src/utils/field.rs:215-258`. The inverse MDS is computed via the closed-form
Cauchy inverse, but we only need the forward matrix for decrypt.

## Rescue-Prime hash (sponge)

`src/utils/crypto/rescue_prime_hash.rs`.

| Param        | Value                            |
|--------------|----------------------------------|
| State width m | 12                               |
| Rate          | 7                                |
| Capacity      | 5                                |
| Digest length | 5 (`RESCUE_KEY_COUNT`)           |
| Rounds N      | computed (see below)             |
| Padding       | append F::ONE then zero-pad to multiple of rate |
| Initial state | zero matrix (m × 1)              |

Rounds N for the hash: solve for smallest l1 ≥ 1 such that
`binomial(v + dcon, v)^2 > 2^256`, where
`dcon = floor(0.5*(α-1)*m*(l1-1) + 2)` and `v = m*(l1-1) + rate`. Then
`N = ceil(1.5 * max(5, l1))`. See `src/utils/crypto/rescue_desc.rs:148-180`.

Round-constant generation: SHAKE256 with seed
`"Rescue-XLIX({p},{m},{capacity},256)"`. Read `2*m*N` field elements, each as
`(NUM_BITS/8 + 16) = 48` little-endian bytes interpreted as a big integer mod p,
then reshape into `2*N` matrices of size (m × 1). A zero matrix is prepended at
index 0. See `src/utils/crypto/rescue_desc.rs:233-265`.

## Rescue block cipher (CTR mode)

`src/utils/crypto/rescue_cipher.rs`, `src/utils/crypto/rescue_desc.rs:69-108`.

| Param        | Value                              |
|--------------|------------------------------------|
| State width m | 5 (`RESCUE_KEY_COUNT`)             |
| Rounds N      | computed (see below)               |
| Mode          | Counter (CTR), but **arithmetic** — see "encrypt/decrypt" |

Rounds for the cipher: `2 * max(l0, l1, 5)` where
- `l0 = ceil(2*128 / ((m+1) * (log2(p) - log2(α-1))))`
- `l1 = ceil((128 + 3) / (m * 5.5))` (since α ≠ 3)

Round-constant generation: SHAKE256 with seed
`b"encrypt everything, compute anything"`. Read `m*m + 2*m` field elements to
build:
- a square `(m × m)` matrix `RC_mat`
- two `(m × 1)` vectors `RC_initial`, `RC_affine`

The initial round constant matrix is `RC_initial`. Subsequent round constants
are produced by iterating `c_{k+1} = RC_mat · c_k + RC_affine` for `2*N` steps.
If `det(RC_mat) == 0` the matrix is resampled until invertible.
See `src/utils/crypto/rescue_desc.rs:190-232`.

### Key schedule

Given the master `RescueKey` (5 field elements, the KDF output), expand to
`2*N + 1` round keys by running the Rescue permutation with the **round
constants** in the role of subkeys and the **key** in the role of the input
state. The intermediate states across the permutation become the round keys.
See `src/utils/crypto/rescue_desc.rs:84-96`.

### Permutation

For both the cipher and the hash, the permutation is:

```
state ← state + subkeys[0]
for r in 0..2N:
    if r even:
        state[i] ← state[i]^e_even    for all i
    else:
        state[i] ← state[i]^e_odd     for all i
    state ← MDS · state
    state ← state + subkeys[r + 1]
```

- **Cipher**: `e_even = α⁻¹`, `e_odd = α`. (S-box on even half-rounds.)
- **Hash**:   `e_even = α`,   `e_odd = α⁻¹`.

`src/utils/crypto/rescue_desc.rs:298-340`.

### Encrypt / decrypt (CTR)

`src/utils/crypto/rescue_cipher.rs:94-183`.

For each block index `i ∈ [0, n_blocks)`:

```
counter_block_i = [nonce, F(i), F(0), F(0), F(0)]           // m = 5 field elements
keystream_i     = permute(counter_block_i, with round_keys derived from cipher_key)

ciphertext_i    = plaintext_i + keystream_i                 // field addition
plaintext_i     = ciphertext_i - keystream_i                // field subtraction
```

**Note**: Arcium uses **field addition / subtraction**, not XOR. This is safe
per <https://crypto.stackexchange.com/questions/1666/>. So a "byte" of plaintext
is really a field element, not a u8.

Plaintext block size = m = 5 field elements = 160 bytes. Our challenge is
chosen to fit in 1 block.

## Key Derivation Function (KDF)

`src/utils/crypto/rescue_cipher.rs:69-84`.

NIST SP 800-56C r2 §4 Option 1 with Rescue-Prime as the hash:

```
input = [F(1), F(shared_secret), F(RESCUE_KEY_COUNT = 5)]
key   = RescuePrime(input)                                   // 5 field elements
```

The "F(shared_secret)" is the X25519 ECDH output (Montgomery u-coord) converted
to a single `BaseField` element — i.e. the raw 32 bytes interpreted as a little-
endian integer mod p.

## Nonce

`nonce: u128` (16 bytes), generated client-side via `ArcisRNG::gen_public_integer_from_width(128)`
(`arcis-0.9.6/src/standard_library/crypto.rs`). On chain it is stored as a
single field element. The stake account already persists it as
`StakeAccount.state_nonce_disclosure: u128`.

## On-chain ciphertext format

Each `Enc<Shared, T>` block is 1 field element = 32 bytes, serialized
little-endian. `StakeAccount.encrypted_option_disclosure: [u8; 32]` is exactly
this. For our Challenge struct (16 plaintext bytes), 1 block is plenty.

## MXE public key

`arcis-compiler-0.9.6/src/utils/crypto/key.rs:370-373`:

```
MXE_X25519_PRIVATE_KEY = [
    207, 40, 181, 230, 45, 204, 46, 17, 8, 19, 251, 241, 43, 129, 216, 23,
    86, 169, 218, 248, 95, 114, 111, 9, 188, 159, 223, 16, 124, 98, 41, 1,
]
```

This is the secret key. The MXE public key is the X25519 basepoint multiplied
by this scalar; it's reused across all markets, all platforms, all users. The
market creator computes the shared secret off-chain as
`shared_secret = ECDH(authorized_reader_sk, MXE_pk)` and submits it to
`reveal_shared_secret`.

(Note: this constant is from the compiler crate, which represents what the
local Arcis test environment uses. The mainnet MXE may use a different
pubkey — confirm via `getMXEPublicKey()` from the TS SDK before shipping.)
