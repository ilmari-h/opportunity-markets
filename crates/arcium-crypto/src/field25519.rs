//! F_{2^255-19} field arithmetic — a thin wrapper around `fiat-crypto`'s
//! formally-verified `curve25519_64` module.
//!
//! `fiat-crypto` distinguishes "tight" and "loose" representations of a field
//! element (5 × u64 in 51-bit radix). Tight is canonical; loose is the looser
//! form produced by add/sub and accepted as input by mul. We always store
//! tight and convert on the boundaries — slightly suboptimal vs. tracking
//! tight/loose at every step, but vastly simpler for callers and the
//! difference is negligible at our scale (one Rescue permutation per stake).

use fiat_crypto::curve25519_64::{
    fiat_25519_add, fiat_25519_carry, fiat_25519_carry_mul, fiat_25519_carry_square,
    fiat_25519_from_bytes, fiat_25519_loose_field_element, fiat_25519_opp, fiat_25519_relax,
    fiat_25519_sub, fiat_25519_tight_field_element, fiat_25519_to_bytes,
};

/// Field element in F_{2^255-19}, stored in fiat-crypto's 5-limb tight form.
///
/// Equality is **value equality**: two field elements compare equal iff their
/// canonical 32-byte serializations are equal. Raw limb arrays may differ even
/// when the underlying value is the same (fiat's tight form is not strictly
/// canonical above the p−1 boundary).
#[derive(Clone, Copy, Debug)]
pub struct F25519 {
    inner: [u64; 5],
}

impl F25519 {
    pub const ZERO: Self = Self { inner: [0; 5] };
    pub const ONE: Self = Self { inner: [1, 0, 0, 0, 0] };

    fn tight(&self) -> fiat_25519_tight_field_element {
        fiat_25519_tight_field_element(self.inner)
    }

    fn from_tight(t: fiat_25519_tight_field_element) -> Self {
        Self { inner: t.0 }
    }

    fn loose(&self) -> fiat_25519_loose_field_element {
        let mut out = fiat_25519_loose_field_element([0; 5]);
        fiat_25519_relax(&mut out, &self.tight());
        out
    }

    pub fn from_le_bytes(bytes: &[u8; 32]) -> Self {
        // fiat_25519_from_bytes implicitly masks the high bit per X25519 convention.
        let mut t = fiat_25519_tight_field_element([0; 5]);
        fiat_25519_from_bytes(&mut t, bytes);
        Self::from_tight(t)
    }

    pub fn to_le_bytes(self) -> [u8; 32] {
        let mut out = [0u8; 32];
        fiat_25519_to_bytes(&mut out, &self.tight());
        out
    }

    pub fn from_u64(v: u64) -> Self {
        let mut bytes = [0u8; 32];
        bytes[..8].copy_from_slice(&v.to_le_bytes());
        Self::from_le_bytes(&bytes)
    }

    pub fn from_i64(v: i64) -> Self {
        if v >= 0 {
            Self::from_u64(v as u64)
        } else {
            -Self::from_u64(v.unsigned_abs())
        }
    }

    pub fn is_zero(&self) -> bool {
        self.to_le_bytes() == [0u8; 32]
    }
}

impl PartialEq for F25519 {
    fn eq(&self, other: &Self) -> bool {
        self.to_le_bytes() == other.to_le_bytes()
    }
}

impl Eq for F25519 {}

impl core::hash::Hash for F25519 {
    fn hash<H: core::hash::Hasher>(&self, state: &mut H) {
        self.to_le_bytes().hash(state);
    }
}

impl F25519 {

    /// `self^exp` via square-and-multiply. `exp` is little-endian bytes.
    pub fn pow(self, exp: &[u8; 32]) -> Self {
        let mut acc = Self::ONE;
        for byte in exp.iter().rev() {
            for bit in (0..8).rev() {
                acc = acc * acc;
                if (byte >> bit) & 1 == 1 {
                    acc = acc * self;
                }
            }
        }
        acc
    }

    /// Multiplicative inverse via Fermat: `a^(p-2)` with `p = 2^255 − 19`,
    /// so `p − 2` little-endian = `[0xEB, 0xFF*30, 0x7F]`.
    pub fn invert(self) -> Self {
        let mut exp = [0xFFu8; 32];
        exp[0] = 0xEB;
        exp[31] = 0x7F;
        self.pow(&exp)
    }
}

impl core::ops::Add for F25519 {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        let mut loose = fiat_25519_loose_field_element([0; 5]);
        fiat_25519_add(&mut loose, &self.tight(), &rhs.tight());
        let mut tight = fiat_25519_tight_field_element([0; 5]);
        fiat_25519_carry(&mut tight, &loose);
        Self::from_tight(tight)
    }
}

impl core::ops::Sub for F25519 {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        let mut loose = fiat_25519_loose_field_element([0; 5]);
        fiat_25519_sub(&mut loose, &self.tight(), &rhs.tight());
        let mut tight = fiat_25519_tight_field_element([0; 5]);
        fiat_25519_carry(&mut tight, &loose);
        Self::from_tight(tight)
    }
}

impl core::ops::Neg for F25519 {
    type Output = Self;
    fn neg(self) -> Self {
        let mut loose = fiat_25519_loose_field_element([0; 5]);
        fiat_25519_opp(&mut loose, &self.tight());
        let mut tight = fiat_25519_tight_field_element([0; 5]);
        fiat_25519_carry(&mut tight, &loose);
        Self::from_tight(tight)
    }
}

impl core::ops::Mul for F25519 {
    type Output = Self;
    fn mul(self, rhs: Self) -> Self {
        let mut tight = fiat_25519_tight_field_element([0; 5]);
        fiat_25519_carry_mul(&mut tight, &self.loose(), &rhs.loose());
        Self::from_tight(tight)
    }
}

impl F25519 {
    /// Slightly cheaper than `self * self` because fiat-crypto specializes it.
    pub fn square(self) -> Self {
        let mut tight = fiat_25519_tight_field_element([0; 5]);
        fiat_25519_carry_square(&mut tight, &self.loose());
        Self::from_tight(tight)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_one() {
        assert!(F25519::ZERO.is_zero());
        assert!(!F25519::ONE.is_zero());
        assert_eq!(F25519::ONE + F25519::ZERO, F25519::ONE);
    }

    #[test]
    fn roundtrip_bytes() {
        let n = 0x1234_5678_9abc_def0u64;
        let f = F25519::from_u64(n);
        let bytes = f.to_le_bytes();
        let f2 = F25519::from_le_bytes(&bytes);
        assert_eq!(f, f2);
    }

    #[test]
    fn add_wraps_at_p() {
        let p_minus_1 = F25519::ZERO - F25519::ONE;
        assert_eq!(p_minus_1 + F25519::ONE, F25519::ZERO);
    }

    #[test]
    fn sub_underflow() {
        let r = F25519::ZERO - F25519::ONE;
        assert_eq!(r + F25519::ONE, F25519::ZERO);
        assert_eq!(r * F25519::ONE, r);
    }

    #[test]
    fn mul_basic() {
        let a = F25519::from_u64(7);
        let b = F25519::from_u64(13);
        assert_eq!(a * b, F25519::from_u64(91));
    }

    #[test]
    fn mul_large() {
        let m1 = F25519::ZERO - F25519::ONE;
        assert_eq!(m1 * m1, F25519::ONE);
    }

    #[test]
    fn square_matches_mul() {
        let a = F25519::from_u64(42);
        assert_eq!(a.square(), a * a);
    }

    #[test]
    fn invert_basic() {
        let a = F25519::from_u64(7);
        let inv = a.invert();
        assert_eq!(a * inv, F25519::ONE);
    }

    #[test]
    fn invert_large() {
        let a = F25519::from_le_bytes(&[
            0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
            0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
            0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00,
            0xfe, 0xed, 0xfa, 0xce, 0xca, 0xfe, 0xba, 0x7e,
        ]);
        let inv = a.invert();
        assert_eq!(a * inv, F25519::ONE);
    }

    #[test]
    fn pow_5_matches_repeated_mul() {
        let a = F25519::from_u64(42);
        let manual = a * a * a * a * a;
        let mut exp = [0u8; 32];
        exp[0] = 5;
        assert_eq!(a.pow(&exp), manual);
    }
}
