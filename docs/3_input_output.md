# Input/Output

Inputs and outputs in confidential instructions are handled in the same way. The Arcium network does not mutate any state itself. Both inputs and outputs can be encrypted or plaintext data, either being passed by value or by reference. Passing by reference is only possible for account data, where the Arcium nodes will be able to fetch data from the account. This is beneficial for accounts where data is larger than what can fit in a single Solana transaction, or if you want to avoid storage costs for the data while the computation is in progress (as each input has to be written to a computation object for the duration of the computation).

Encrypted data is passed as an `Enc<Owner, T>` generic type, where `Owner` specifies who can decrypt the data:

* **`Enc<Shared, T>`**: Data encrypted with a shared secret between the client and MXE. Both the client and MXE can decrypt this data. Use this when:
  * Accepting user inputs that the user needs to verify later
  * Returning results the user must be able to decrypt
  * Implementing privacy-preserving user interactions
* **`Enc<Mxe, T>`**: Data encrypted exclusively for the MXE. Only the MXE nodes (acting together) can decrypt this data. Use this when:
  * Storing internal state that users shouldn't access directly
  * Passing data between MXE functions
  * Protecting protocol-level data from individual users

Learn more about [encryption in Arcium Network](/developers/encryption).

```rust  theme={null}
// Define the data structures we'll work with
struct Order {
    size: u64,
    bid: bool,
    owner: u128,
}

// OrderBook must be a fixed-size structure for MPC
const ORDER_BOOK_SIZE: usize = 100; // Maximum orders supported

struct OrderBook {
    orders: [Order; ORDER_BOOK_SIZE],
}

#[instruction]
pub fn add_order(
    order_ctxt: Enc<Shared, Order>,
    ob_ctxt: Enc<Mxe, &OrderBook>,
) -> Enc<Mxe, OrderBook> {
    let order = order_ctxt.to_arcis();
    let mut ob = *(ob_ctxt.to_arcis());
    let mut found = false;
    for i in 0..ORDER_BOOK_SIZE {
        let overwrite = ob.orders[i].size == 0 && !found;
        if overwrite {
            ob.orders[i] = order;
        }
        found = overwrite || found;
    }
    ob_ctxt.owner.from_arcis(ob)
}
```

Let's use this example to understand how to pass inputs into confidential instructions, compute on them and return outputs. Here, we are trying to add an order to an existing order book.

In this example, `order_ctxt: Enc<Shared, Order>` is passed by value, meaning the entire encrypted order data is submitted onchain. In contrast, `ob_ctxt: Enc<Mxe, &OrderBook>` is passed by reference - only the account's public key is submitted onchain, and the MPC nodes will fetch the actual data from that account during computation. This is particularly useful for large data structures like order books that might not fit in a single transaction.

In order to use the parameters `order_ctxt` and `ob_ctxt` for computation, we need to convert them to corresponding secret shares for the nodes to compute in MPC. This can be done by calling `to_arcis` function on any `Enc` generic parameter. This does not reveal the plaintext data underneath to the nodes during the process.

Here, the order parameter disappears after the confidential instruction has been processed (just as you'd expect in regular rust too). To output the new order book, we convert it back using `from_arcis` on `ob_ctxt.owner` field which defines the owner, aka the party which encrypted the data, to get the new `Enc<Origin, T>` type, and return it.

Currently, as many outputs as can fit in a single transaction are sent in the callback transaction, whereas the rest are all sent to the [callback server](/developers/callback-server) for state updates. This means that you might need to make state changes through the callback server, and are responsible for updating the onchain accounts, if needed.

For more details on how to invoke these encrypted instructions from your Solana program, see [Invoking a Computation](/developers/program).


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
