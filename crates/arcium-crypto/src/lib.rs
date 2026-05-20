#![cfg_attr(not(any(test, feature = "host")), no_std)]

//! Pure-Rust port of the Arcium Rescue cipher stack, sufficient to decrypt an
//! `Enc<Shared, T>` ciphertext on Solana given the X25519 ECDH shared secret as
//! input. See `spec.md` for the full parameter set extracted from
//! `arcis-compiler` 0.9.6.
//!
//! The pipeline this crate implements:
//!
//! ```text
//!   shared_secret  →  Rescue-Prime KDF  →  RescueKey  →  RescueCipher (CTR)  →  plaintext
//! ```
//!
//! No X25519 operations are performed here — the shared secret is supplied by
//! the caller (the market creator, off-chain).

extern crate alloc;

pub mod field25519;

pub use field25519::F25519;
