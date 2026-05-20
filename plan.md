# Plan — one-shot market reveal via shared-secret challenge

## Why

Today `reveal_stake` is one MPC round-trip per stake account. A market with N
stakes needs N MPC calls before rewards can be distributed. Goal: cut reveal
to **zero MPC calls after market resolution**, regardless of N.

## The design

Arcium encrypts each stake's `encrypted_option_disclosure` using:

```
shared_secret = ECDH(authorized_reader_sk, MXE_pk)      // off-chain, deterministic per market
cipher_key    = RescuePrime-KDF(shared_secret)
ciphertext    = plaintext + RescueCipher_CTR(cipher_key, nonce)        // field addition over F_{2^255-19}
```

The same `shared_secret` is reused for every stake in the market because both
ECDH inputs are fixed for the market's lifetime. So if the program can get
that one secret on-chain and validate it, every stake becomes decryptable
on-chain forever after.

The shared secret cannot be extracted from inside an Arcis circuit (the
arcis-compiler seals it behind opaque cipher setup — `get_shared_secret` is
not exposed in `arcis::*`). So we use a **challenge-response** instead:

### Lifecycle

1. **`create_market`** (extended): also queue one MPC call to a new Arcis
   circuit `emit_challenge`, which produces `Enc<Shared, KnownPlaintext>` to
   `authorized_reader_pubkey`. The challenge ciphertext + nonce are stored on
   the market account. `open_market` is gated on the challenge being present.
2. **Staking** (unchanged). Each stake's `encrypted_option_disclosure` is
   encrypted with the same shared secret as the challenge.
3. **`reveal_shared_secret`** (new, **pure BPF, no MPC**): once the market is
   resolved, the market creator computes
   `shared_secret = ECDH(authorized_reader_sk, MXE_pk)` off-chain and submits
   it. The on-chain program runs Rescue-Prime KDF → derives the cipher key →
   decrypts the stored challenge → asserts plaintext equals the known
   constant. On success, caches `shared_secret` and the derived `cipher_key`
   on the market account.
4. **`finalize_reveal_stake`** (rewritten, no MPC, permissionless): reads the
   cached cipher key, decrypts that stake's `encrypted_option_disclosure`
   using the stake's already-stored `state_nonce_disclosure`, recovers the
   plaintext `option_id`, runs the existing scoring/tally logic.
5. **Delete** the per-stake MPC `reveal_stake` instruction and circuit.

Total MPC calls per market for reveal: **0**. (One MPC call at create-market
for the challenge, amortized over the whole market.)

## Why not alternatives

- **Reveal `authorized_reader_sk` itself**: would need on-chain X25519 ECDH
  too. `solana-curve25519` syscalls only support Edwards/Ristretto, not
  Montgomery; `curve25519-dalek` is broken on BPF; the Edwards-via-birational
  workaround is unmapped territory on Solana. Avoided.
- **Extract the secret from inside a circuit and `.reveal()` it**: the
  arcis-compiler buries it inside opaque cipher setup; `get_shared_secret`
  isn't exposed in `arcis::*`, and `Cipher::encrypt_vec` / `RescueKey` are
  `#[doc(hidden)]` / `pub(crate)`. Not possible without forking the
  framework.
- **Batched reveal** (one MPC call per ~50 stakes): no new on-chain crypto
  but still O(N/K) MPC calls. Easier to ship but worse asymptotics.

## What needs to be built

### a) `crates/arcium-crypto/` — pure-Rust no_std crypto crate (in progress)

- ✅ **F25519 field arithmetic** — wraps `fiat-crypto`'s `curve25519_64`
  module. One dep (formally verified, no_std, BPF-friendly). 10 unit tests
  pass. `src/field25519.rs`.
- ⬜ **Rescue-Prime hash** (sponge: state width m=12, rate=7, capacity=5,
  digest 5 field elements). For KDF.
- ⬜ **MDS matrix** — Cauchy on `x=[1..=m], y=[-1..=-m]`, computed once.
- ⬜ **Round-constant tables** — SHAKE256 output baked into `const` tables
  (host-only generator behind a `host` cargo feature, on-chain code stays
  dependency-free).
- ⬜ **Rescue cipher** — block cipher (state m=5) + key schedule +
  permutation + CTR-mode encrypt/decrypt over `F25519`.
- ⬜ **Rescue-Prime KDF wrapper** — `[F(1), F(shared_secret), F(5)]` input,
  truncate to 5 field elements.

No public Rust crate provides Rescue/Rescue-Prime over `F_{2^255-19}`. Every
existing impl targets STARK fields (Goldilocks / BLS12-381 / BN254). We port
from `arcis-compiler` 0.9.6 sources (paths in `crates/arcium-crypto/src/spec.md`).

### b) `encrypted-ixs/src/lib.rs` — Arcis circuits

- ⬜ New circuit `emit_challenge(recipient: Shared) -> Enc<Shared, Challenge>`
  that just re-encrypts a known constant struct to the supplied recipient.
- ⬜ Delete the existing `reveal_stake` circuit.

### c) `programs/opportunity_market/` — on-chain program

- ⬜ State additions on `OpportunityMarket`: `challenge_ciphertext: [u8; 32]`,
  `challenge_nonce: u128`, `challenge_ready: bool`,
  `revealed_shared_secret: Option<[u8; 32]>`, `cached_cipher_key: Option<[u8; 160]>`
  (5 × 32 packed).
- ⬜ State removal on `StakeAccount`: `pending_reveal` (no longer used).
- ⬜ New instruction `init_challenge` (queues the `emit_challenge` MPC + its
  callback) — or fold into `create_market` if `arcium_anchor` allows queuing
  in the same instruction.
- ⬜ New instruction `reveal_shared_secret` — pure BPF, validates via
  challenge decrypt + caches.
- ⬜ Rewrite `finalize_reveal_stake` — drops MPC dependency, uses cached
  cipher key + on-chain Rescue decrypt.
- ⬜ Delete `reveal_stake.rs`. Update `init_comp_defs.rs`, `mod.rs`.
- ⬜ Gate `open_market` on `challenge_ready`.

### d) Reference vectors + tests

- ⬜ TS script under `scripts/` using `@arcium-hq/client` `RescueCipher` to
  encrypt the `Challenge` struct to a known X25519 keypair against a known
  MXE pubkey. Outputs JSON: `shared_secret`, `nonce`, `ciphertext`,
  `plaintext`.
- ⬜ Host-side Rust test in `crates/arcium-crypto/tests/` that decrypts the
  fixture and asserts round-trip equality. This pins the spec before any
  on-chain code.
- ⬜ Solana program test (`tests/`): create market → wait for challenge →
  3 stakes with known option_ids → resolve → `reveal_shared_secret(correct)`
  → `finalize_reveal_stake` × 3 → assert recovered option_ids match.
- ⬜ Negative test: `reveal_shared_secret(wrong)` must fail with
  `InvalidSharedSecret`, leave state untouched.
- ⬜ CU budget measurement: target `finalize_reveal_stake` < 200k CU.

### e) Docs

- ⬜ Update `docs/README.md` "Revealing stakes" section.

## Open considerations

- **Cross-market key reuse**: revealing the shared secret for one market also
  unlocks any other market whose creator used the same x25519 keypair. The
  fix is documentation — creators MUST use a fresh key per market — not an
  on-chain check.
- **MXE pubkey**: the creator needs the MXE's permanent X25519 pubkey to
  compute the shared secret off-chain. Pin which one (mainnet vs. local) and
  document the source (TS `getMXEPublicKey()`).
- **CU budget**: Rescue-Prime KDF is ~64 rounds and Rescue-CTR is one
  permutation per stake block. Estimated 50–150k CU per decrypt. Target
  comfortably under the 200k default Solana limit. If we blow it, evaluate
  raising the request limit before optimizing.

## References

- Parameter spec extracted from arcis-compiler 0.9.6:
  [`crates/arcium-crypto/src/spec.md`](crates/arcium-crypto/src/spec.md)
- arcis-compiler source (local):
  `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/arcis-compiler-0.9.6/src/utils/crypto/`
  — files: `rescue_cipher.rs`, `rescue_prime_hash.rs`, `rescue_desc.rs`, `key.rs`
- Arcium TS client (`RescueCipher` reference impl):
  https://ts.arcium.com/api/client/classes/RescueCipher
- Arcium encryption overview: https://docs.arcium.com/developers/encryption
- Shared-secret caching pattern (confirms determinism):
  https://www.arcium.com/articles/shared-rescue-keys-caching-optimization
