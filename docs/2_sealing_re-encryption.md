
# Sealing aka re-encryption

Suppose you're Alice, and you have secret data onchain, and you want to share it with Bob. Or it could be that you want to compute a function on your sensitive data, and share the result with Bob without revealing the data, or the result to anyone else.

Arcium enables you to re-encrypt any data to a given public key. This is known as "sealing" in cryptography, effectively having the ability to restrict data access and information flow.

This is useful for a variety of reasons, such as compliance, end-to-end privacy, and more.

```rust  theme={null}
#[encrypted]
mod circuits {
    use arcis::*;

    #[instruction]
    pub fn verify_loan_eligibility(
        alice_balance: Enc<Shared, u64>,
        min_balance_required: Enc<Mxe, u64>,
        loan_officer: Shared
    ) -> Enc<Shared, bool> {
        let balance = alice_balance.to_arcis();
        let threshold = min_balance_required.to_arcis();

        // Check if Alice meets minimum balance for loan without revealing her exact balance
        let is_eligible = balance >= threshold;

        // Re-encrypt the result for the loan officer
        loan_officer.from_arcis(is_eligible)
    }
}
```

In this example, we have a confidential function `verify_loan_eligibility` that takes Alice's encrypted balance (encrypted with a shared secret between Alice and the MXE), the minimum balance requirement (encrypted only for the MXE), and a `Shared` type parameter representing the loan officer who will receive the result.

The function checks if Alice meets the minimum balance requirement for loan eligibility without revealing her actual balance to anyone. The boolean result is then re-encrypted specifically for the loan officer using their public key. This way, Alice's financial privacy is preserved - the loan officer only learns whether she's eligible, not her actual balance, and the MPC nodes never see the unencrypted values.


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
