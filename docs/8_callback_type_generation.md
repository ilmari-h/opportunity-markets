# Callback Type Generation

## What This Solves

When you write encrypted instructions in Arcium, the results come back as structured data. Previously, developers had to manually parse raw bytes - tracking offsets, sizes, and converting back to the right types. This was error-prone and tedious.

Arcium's type generation system analyzes your circuit's return type and automatically creates typed Rust structs. This means you can work directly with structured data instead of byte arrays.

## Mental Model: From Functions to Structs

Here's the transformation that happens automatically:

```rust  theme={null}
// You write this encrypted instruction:
#[instruction]
pub fn add_numbers() -> Enc<Shared, u64> { /* ... */ }

// Arcium generates this for your callback:
pub struct AddNumbersOutput {
    pub field_0: SharedEncryptedStruct<1>, // 1 = single u64 value
}
```

The generated struct gives you typed access to encrypted results, with predictable naming and field patterns you can rely on.

## What You'll Learn

After reading this guide, you'll know how to:

* Work with automatically generated Rust structs for encrypted computation outputs
* Predict what struct names and fields Arcium will create
* Handle different encryption types (Shared vs MXE) in callbacks
* Debug type generation issues when they arise

## 30-Second Quick Start

1. Write your circuit:

   ```rust  theme={null}
   #[instruction]
   pub fn my_calc() -> Enc<Shared, u64> { /* ... */ }
   ```
2. Generate types: `arcium build`
3. Use in callback:

   ```rust  theme={null}
   #[arcium_callback(encrypted_ix = "my_calc")]
   pub fn my_calc_callback(
       ctx: Context<MyCalcCallback>,
       output: SignedComputationOutputs<MyCalcOutput>,
   ) -> Result<()> {
       let o = match output.verify_output(
           &ctx.accounts.cluster_account,
           &ctx.accounts.computation_account
       ) {
           Ok(MyCalcOutput { field_0 }) => field_0,
           Err(_) => return Err(ErrorCode::AbortedComputation.into()),
       };
       let encrypted_value = o.ciphertexts[0];
       // Your logic here
       Ok(())
   }
   ```

## Your First Generated Type: Simple Addition

Here's a concrete example. Consider this encrypted instruction that adds two numbers:

```rust  theme={null}
#[encrypted]
mod circuits {
    use arcis::*;

    #[instruction]
    pub fn add_together(input: Enc<Shared, (u8, u8)>) -> Enc<Shared, u16> {
        let (a, b) = input.to_arcis();
        let sum = a as u16 + b as u16;
        input.owner.from_arcis(sum)
    }
}
```

When Arcium sees that your function returns `Enc<Shared, u16>`, it automatically generates this output struct:

```rust  theme={null}
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AddTogetherOutput {
    pub field_0: SharedEncryptedStruct<1>,
}
```

Notice the pattern:

* **Name**: `add_together` becomes `AddTogetherOutput`
* **Field**: Always `field_0` for single return values
* **Type**: `SharedEncryptedStruct<1>` because it's shared-encrypted with 1 value (the u16)

Now you can use this in your callback with full type safety:

```rust  theme={null}
#[arcium_callback(encrypted_ix = "add_together")]
pub fn add_together_callback(
    ctx: Context<AddTogetherCallback>,
    output: SignedComputationOutputs<AddTogetherOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account
    ) {
        Ok(AddTogetherOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    // Access the encrypted result and metadata
    emit!(SumEvent {
        sum: o.ciphertexts[0],      // The encrypted u16 sum
        nonce: o.nonce.to_le_bytes(), // Nonce for decryption
    });
    Ok(())
}
```

## How Type Generation Works

Working with encrypted computation results used to require manual byte parsing - tracking offsets, sizes, and types yourself. Arcium generates typed structs automatically, so you can focus on application logic instead of low-level data handling.

### The Macro Magic

Here's the key insight: when you write an encrypted instruction with the `#[instruction]` macro, something important happens behind the scenes. The macro doesn't just process your function - it also generates corresponding Rust structs based on your return type.

```rust  theme={null}
#[instruction]
pub fn add_together(input: Enc<Shared, (u8, u8)>) -> Enc<Shared, u16> {
    // Your function code here
}
```

During macro expansion, Arcium analyzes that `Enc<Shared, u16>` return type and automatically generates:

```rust  theme={null}
// This struct is generated for you - you never write it yourself!
pub struct AddTogetherOutput {
    pub field_0: SharedEncryptedStruct<1>,
}
```

This is why you can reference `AddTogetherOutput` in your callback even though you never explicitly defined it. The macro created it for you during compilation, and it's automatically available in your program's scope.

### Immediate Availability

These generated types become available as soon as the macro runs - which happens during normal Rust compilation. You don't need to wait for a separate build step to start using them in your callback functions.

```rust  theme={null}
// This works immediately after defining your #[instruction] above
#[arcium_callback(encrypted_ix = "add_together")]
pub fn callback(
    ctx: Context<AddTogetherCallback>,
    output: SignedComputationOutputs<AddTogetherOutput>,
) -> Result<()> {
    // AddTogetherOutput is available here automatically
}
```

## Behind the Scenes: What the Macro Actually Does

Understanding how the `#[instruction]` macro generates types helps explain why the system works the way it does.

### Macro Expansion Process

When Rust processes your `#[instruction]` macro, here's what happens:

1. **Parse the return type**: The macro examines your function signature and extracts the return type
2. **Analyze the structure**: It breaks down complex types (tuples, structs, encryption wrappers) into components
3. **Generate struct definitions**: It creates typed structs that match your return type's structure
4. **Inject into scope**: The generated types become available in your program module automatically

### What Gets Generated

For different return types, the macro generates different struct patterns:

```rust  theme={null}
// Your function:
#[instruction]
pub fn simple() -> Enc<Shared, u32>

// Macro generates:
pub struct SimpleOutput {
    pub field_0: SharedEncryptedStruct<1>,
}
```

```rust  theme={null}
// Your function:
#[instruction]
pub fn complex() -> (Enc<Shared, u32>, Enc<Mxe, bool>)

// Macro generates:
pub struct ComplexOutput {
    pub field_0: ComplexOutputStruct0,
}
pub struct ComplexOutputStruct0 {
    pub field_0: SharedEncryptedStruct<1>,
    pub field_1: MXEEncryptedStruct<1>,
}
```

### Why This Approach Works

This macro-driven approach provides several benefits:

* **Type safety**: You get compile-time type checking for encrypted results
* **No manual definition**: You don't need to define output structs yourself
* **Consistency**: All generated types follow the same predictable patterns
* **Automatic updates**: If you change your function's return type, the structs update automatically

The key insight is that these structs exist in your compiled program but not in your source code - they're created during the build process and become available for you to use.

## Understanding LEN Parameters

In our `add_together` example, you saw `SharedEncryptedStruct<1>`. The `<LEN>` number tells you how many encrypted scalar values are stored inside.

The `<LEN>` number represents the count of individual encrypted scalar values:

| Return Type                | LEN Value   | Why                               |
| -------------------------- | ----------- | --------------------------------- |
| `Enc<Shared, u32>`         | 1           | Single scalar                     |
| `Enc<Shared, (u32, bool)>` | 2           | Two scalars                       |
| `Enc<Shared, [u32; 5]>`    | 5           | Five array elements               |
| `Enc<Shared, MyStruct>`    | field count | Count all scalar fields in struct |

**For custom structs**, LEN equals total scalar fields:

```rust  theme={null}
struct UserProfile {
    id: u32,        // 1 scalar
    balance: u64,   // 1 scalar
    active: bool,   // 1 scalar
}
// Result: SharedEncryptedStruct<3>
```

## Type Availability and Scope

### Where Generated Types Live

Generated types are automatically scoped to your program module and become available immediately after the `#[instruction]` macro runs. This means:

```rust  theme={null}
// In your lib.rs or program module
#[instruction]
pub fn calculate() -> Enc<Shared, u64> { /* ... */ }

// CalculateOutput is now available in this same module scope
#[arcium_callback(encrypted_ix = "calculate")]
pub fn callback(
    ctx: Context<CalculateCallback>,
    output: SignedComputationOutputs<CalculateOutput>,
) -> Result<()> {
    // You can reference CalculateOutput here
}
```

### No Import Required

Unlike external types, you don't need to import generated types. They're injected directly into your module's namespace during macro expansion:

```rust  theme={null}
// No need for: use some_crate::CalculateOutput;
// The type just exists automatically
```

### Generated Struct Properties

All generated structs automatically receive standard derives that make them work with Anchor:

```rust  theme={null}
// Every generated struct gets these automatically:
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct YourFunctionOutput {
    // fields...
}
```

This is why you can use generated types in Anchor contexts without additional setup.

### Multiple Instructions, Multiple Types

Each `#[instruction]` creates its own set of output types:

```rust  theme={null}
#[instruction] pub fn add() -> Enc<Shared, u32>      // → AddOutput
#[instruction] pub fn multiply() -> Enc<Shared, u32> // → MultiplyOutput
#[instruction] pub fn divide() -> Enc<Shared, u32>   // → DivideOutput
```

All generated types coexist in the same module scope without conflicts.

## Generation Process

When you define an encrypted instruction:

1. Arcium reads your circuit's output types
2. It generates corresponding Rust structs with predictable names
3. It automatically detects encryption patterns and creates specialized types
4. Everything gets integrated into your `#[arcium_callback]` functions

## How the Naming Works

The naming follows predictable patterns:

### Your Circuit Gets an Output Struct

If your encrypted instruction is called `add_together`, you get a struct called `AddTogetherOutput`. Arcium converts your circuit name to PascalCase and adds "Output" at the end.

### Fields Are Numbered

Since Anchor doesn't support tuple structs (yet), Arcium uses numbered fields instead. So if your function returns multiple values, you'll get `field_0`, `field_1`, `field_2`, and so on. Not the prettiest names, but they're consistent and predictable.

### Complex Types Get Their Own Structs

When your function returns complex nested data (like tuples or custom structs), Arcium generates additional helper structs with a unified naming convention:

* All output structs use `{CircuitName}OutputStruct{index}` pattern
* Nested structs within outputs use `{ParentName}OutputStruct{parent_index}{field_index}` pattern
* The naming ensures uniqueness while maintaining consistency

## Encryption Types: Shared vs MXE

Arcium automatically detects different encryption patterns and generates the right struct type. Understanding when each type is used helps you predict the generated structs.

### SharedEncryptedStruct\<N>

When your circuit returns `Enc<Shared, T>`, Arcium knows this is data that both the client and the MXE can decrypt. It generates a struct that includes everything needed for decryption:

```rust  theme={null}
pub struct SharedEncryptedStruct<const LEN: usize> {
    pub encryption_key: [u8; 32],    // The shared public key
    pub nonce: u128,                 // Random nonce for security
    pub ciphertexts: [[u8; 32]; LEN], // Your actual encrypted data
}
```

The `<N>` part tells you how many encrypted values are packed inside. So `SharedEncryptedStruct<1>` has one encrypted value, `SharedEncryptedStruct<3>` has three, and so on.

In your callback, you can access everything you need:

```rust  theme={null}
let shared_key = result.encryption_key;  // For key exchange
let nonce = result.nonce;               // For decryption
let encrypted_value = result.ciphertexts[0]; // Your data
```

### MXEEncryptedStruct\<N>

For `Enc<Mxe, T>` data, only the MXE cluster can decrypt it - clients can't. Since there's no shared secret needed, the struct is simpler:

```rust  theme={null}
pub struct MXEEncryptedStruct<const LEN: usize> {
    pub nonce: u128,                 // Still need the nonce
    pub ciphertexts: [[u8; 32]; LEN], // Your encrypted data
}
```

Notice there's no `encryption_key` field here - that's because clients don't get to decrypt MXE data.

```rust  theme={null}
// Working with MXE-encrypted data
let nonce = result.nonce;
let encrypted_value = result.ciphertexts[0];
// Note: You can't decrypt this on the client side!
```

### EncDataStruct\<N>

For simple encrypted data without key exchange metadata (less commonly used):

```rust  theme={null}
// Pattern: Only N Ciphertexts
pub struct EncDataStruct<const LEN: usize> {
    pub ciphertexts: [[u8; 32]; LEN], // Raw encrypted values
}
```

**Note**: `EncDataStruct<N>` is used in special cases where only ciphertext data is needed without additional metadata. Most applications use `SharedEncryptedStruct<N>` or `MXEEncryptedStruct<N>` instead.

## Moving to Real-World Applications

Now that you understand the basics with our simple addition example, here's how this works in real applications. The key difference is that real apps often:

* **Return multiple values**: Functions return tuples or complex structs instead of single values
* **Mix encryption types**: Some data for users (`Shared`), some for MXE only (`Mxe`)
* **Handle complex data**: Custom structs with multiple fields instead of simple numbers

The type generation system handles all of this automatically - you just need to understand the patterns.

## Real-World Examples

Here's how this type generation works in actual Arcium applications:

### Simple Tuple Example

Let's start with something in between - a function that returns two related values:

```rust  theme={null}
#[instruction]
pub fn calculate_stats(value: u32) -> (Enc<Shared, u32>, Enc<Shared, u32>) {
    // Calculate both the square and double of a number
    (value.square(), value * 2)
}
```

Since this returns a tuple `(Enc<Shared, u32>, Enc<Shared, u32>)`, Arcium generates:

```rust  theme={null}
pub struct CalculateStatsOutput {
    pub field_0: CalculateStatsOutputStruct0,  // The whole tuple becomes one field
}

pub struct CalculateStatsOutputStruct0 {
    pub field_0: SharedEncryptedStruct<1>,     // First u32 (the square)
    pub field_1: SharedEncryptedStruct<1>,     // Second u32 (the double)
}
```

Notice how tuples get wrapped: the tuple itself becomes `field_0`, and its elements become `field_0`, `field_1`, etc.

### Voting Application

Now let's look at a more realistic example. The [confidential voting example](https://github.com/arcium-hq/examples/tree/main/voting) shows a perfect use case. You have poll data that only the MXE should see, and a user's vote that should be shared between the user and the MXE:

```rust  theme={null}
// Example poll data structure (would be defined in your program)
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PollData {
    pub vote_count_yes: u32,
    pub vote_count_no: u32,
    pub is_active: bool,
}

#[instruction]
pub fn vote(
    poll_data: Enc<Mxe, &PollData>,     // Poll results stay private
    vote_choice: Enc<Shared, u8>        // User can verify their vote
) -> (Enc<Mxe, PollData>, Enc<Shared, bool>) {
    // ... voting logic that maintains privacy
}
```

Since this function returns a tuple `(Enc<Mxe, PollData>, Enc<Shared, bool>)`, Arcium generates:

```rust  theme={null}
pub struct VoteOutput {
    pub field_0: VoteOutputStruct0,  // The whole tuple wraps into one field
}

pub struct VoteOutputStruct0 {
    pub field_0: MXEEncryptedStruct<3>,    // The updated poll data (vote_count_yes + vote_count_no + is_active = 3)
    pub field_1: SharedEncryptedStruct<1>, // The vote confirmation (boolean)
}
```

Now in your callback, you can work with properly typed data instead of raw bytes:

```rust  theme={null}
#[arcium_callback(encrypted_ix = "vote")]
pub fn vote_callback(
    ctx: Context<VoteCallback>,
    output: SignedComputationOutputs<VoteOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account
    ) {
        Ok(VoteOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let poll_data = o.field_0;         // The updated poll (MXE only)
    let vote_confirmation = o.field_1; // User's confirmation (shared)

    // Emit an event with the user's confirmation
    emit!(VoteEvent {
        confirmation: vote_confirmation.ciphertexts[0],
        nonce: vote_confirmation.nonce.to_le_bytes(),
    });
    Ok(())
}
```

### Coinflip Application: Back to Basics

After seeing complex tuples and mixed encryption types, let's look at the simplest possible case. The [coinflip example](https://github.com/arcium-hq/examples/tree/main/coinflip) returns just a single encrypted boolean:

```rust  theme={null}
#[instruction]
pub fn flip() -> Enc<Shared, bool> {
    // Generate secure randomness in MPC
    // Return encrypted result that client can decrypt
}
```

Arcium sees this returns `Enc<Shared, bool>` and creates:

```rust  theme={null}
pub struct FlipOutput {
    pub field_0: SharedEncryptedStruct<1>, // Just one boolean
}
```

Your callback:

```rust  theme={null}
#[arcium_callback(encrypted_ix = "flip")]
pub fn flip_callback(
    ctx: Context<FlipCallback>,
    output: SignedComputationOutputs<FlipOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account
    ) {
        Ok(FlipOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    // Emit the encrypted result - client will decrypt to see heads/tails
    emit!(FlipEvent {
        result: o.ciphertexts[0],
        nonce: o.nonce.to_le_bytes(),
    });
    Ok(())
}
```

### Blackjack Application

From the [blackjack example](https://github.com/arcium-hq/examples/tree/main/blackjack) with complex game state:

```rust  theme={null}
// Example structures (would be defined in your blackjack program)
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct GameState {
    pub deck_cards: [u8; 52],
    pub dealer_cards: [u8; 10],
    pub round_number: u32,
    pub game_active: bool,
    pub house_balance: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PlayerHand {
    pub cards: [u8; 10],
    pub card_count: u8,
    pub bet_amount: u64,
}

#[instruction]
pub fn player_hit(
    game_state: Enc<Mxe, &GameState>,
    player_hand: Enc<Shared, PlayerHand>
) -> (Enc<Mxe, GameState>, Enc<Shared, PlayerHand>, Enc<Shared, bool>) {
    // ... game logic
}
```

**Generated types**:

```rust  theme={null}
pub struct PlayerHitOutput {
    pub field_0: PlayerHitOutputStruct0,
}

pub struct PlayerHitOutputStruct0 {
    pub field_0: MXEEncryptedStruct<65>,   // Updated game state (deck_cards[52] + dealer_cards[10] + round_number[1] + game_active[1] + house_balance[1] = 65)
    pub field_1: SharedEncryptedStruct<12>, // Player's new hand (cards[10] + card_count[1] + bet_amount[1] = 12)
    pub field_2: SharedEncryptedStruct<1>, // Is game over? (boolean)
}
```

## Complex Nested Structures

For more complex outputs with nested data structures:

```rust  theme={null}
// Define the custom struct used in the circuit
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UserData {
    pub id: u32,
    pub active: bool,
}

#[instruction]
pub fn complex_example() -> (
    UserData,
    Enc<Shared, u32>,
    (u64, f32),
    Enc<Mxe, bool>
) {
    // ... complex logic
}
```

**Generated types**:

```rust  theme={null}
pub struct ComplexExampleOutput {
    pub field_0: ComplexExampleOutputStruct0, // Entire tuple as single field
}

pub struct ComplexExampleOutputStruct0 {
    pub field_0: ComplexExampleOutputStruct00,  // UserData
    pub field_1: SharedEncryptedStruct<1>,      // Enc<Shared, u32>
    pub field_2: ComplexExampleOutputStruct02,  // (u64, f32) tuple
    pub field_3: MXEEncryptedStruct<1>,         // Enc<Mxe, bool>
}

pub struct ComplexExampleOutputStruct00 {
    pub field_0: u32,   // UserData.id
    pub field_1: bool,  // UserData.active
}

pub struct ComplexExampleOutputStruct02 {
    pub field_0: u64,   // First tuple element
    pub field_1: f32,   // Second tuple element
}
```

**Notice the naming pattern**: We have `ComplexExampleOutputStruct00` and `ComplexExampleOutputStruct02`, but no `ComplexExampleOutputStruct01`. This is because:

* `field_0` (UserData) needs a custom struct → `ComplexExampleOutputStruct00`
* `field_1` (SharedEncryptedStruct) uses a predefined type → no custom struct needed
* `field_2` ((u64, f32) tuple) needs a custom struct → `ComplexExampleOutputStruct02`
* `field_3` (MXEEncryptedStruct) uses a predefined type → no custom struct needed

Only fields that contain custom structs or tuples get their own generated struct definitions.

## Working with Generated Types

### Pattern Matching

Use destructuring to access nested data:

```rust  theme={null}
let ComplexExampleOutput {
    field_0: ComplexExampleOutputStruct0 {
        field_0: user_data,
        field_1: shared_encrypted,
        field_2: tuple_data,
        field_3: mxe_encrypted,
    }
} = match output {
    ComputationOutputs::Success(result) => result,
    _ => return Err(ErrorCode::AbortedComputation.into()),
};

// Access specific fields
let user_id = user_data.field_0;
let is_active = user_data.field_1;
let shared_value = shared_encrypted.ciphertexts[0];
let timestamp = tuple_data.field_0;
```

### Error Handling

Always handle computation failures:

```rust  theme={null}
let result = match output {
    ComputationOutputs::Success(data) => data,
    _ => return Err(ErrorCode::AbortedComputation.into()),
};
```

## Best Practices

### 1. Use Descriptive Variable Names

```rust  theme={null}
// Good
let FlipOutput { field_0: coin_result } = result;
let is_heads = coin_result.ciphertexts[0];

// Less clear
let FlipOutput { field_0 } = result;
let result = field_0.ciphertexts[0];
```

### 2. Document Your Circuit Interfaces

```rust  theme={null}
/// Returns (updated_game_state, player_hand, is_game_over)
#[instruction]
pub fn player_hit(/* ... */) -> (Enc<Mxe, GameState>, Enc<Shared, PlayerHand>, Enc<Shared, bool>) {
    // ...
}
```

### 3. Handle All Computation States

```rust  theme={null}
let result = match output {
    ComputationOutputs::Success(data) => data,
    _ => return Err(ErrorCode::AbortedComputation.into()),
};
```

### 4. Emit Events for Client Tracking

```rust  theme={null}
emit!(ComputationCompleteEvent {
    computation_id: ctx.accounts.computation_account.key(),
    success: true,
    result_hash: result.ciphertexts[0], // or use a hash function if needed
});
```

## When Things Go Wrong

Here are the most common issues and how to fix them:

### "Type not found" Errors

```rust  theme={null}
// Error: cannot find type `MyCircuitOutput` in this scope
output: SignedComputationOutputs<MyCircuitOutput>
```

This usually means one of two things:

1. **Typo in the circuit name** - Check that `MyCircuit` exactly matches your `#[instruction]` function name (case matters!)
2. **You forgot to rebuild** - Run `arcium build` again after making changes to your encrypted instructions

### "No field found" Errors

```rust  theme={null}
// Error: no field `result` on type `AddTogetherOutput`
let value = output.result;
```

Remember, the generated structs use numbered fields like `field_0`, `field_1`, etc. There's no field called `result` unless you specifically named your function that way.

Try this instead:

```rust  theme={null}
let value = output.field_0;  // First (and often only) field
```

### Encryption Type Mismatches

```rust  theme={null}
// Error: expected `SharedEncryptedStruct<1>`, found `MXEEncryptedStruct<1>`
```

This happens when your circuit returns `Enc<Mxe, T>` but your callback expects `Enc<Shared, T>` (or vice versa). Double-check your encrypted instruction's return type - it needs to match what you're expecting in the callback.

## Callback Not Working? Check These:

* [ ] Circuit name matches exactly (case sensitive)
* [ ] Ran `arcium build` after changing circuit
* [ ] Handling all ComputationOutputs variants
* [ ] Using correct field numbers (field\_0, field\_1, etc.)
* [ ] Array access within bounds (ciphertexts.len())

## Finding Generated Types

The best way to see generated types:

```bash  theme={null}
# First install cargo-expand if you haven't already
cargo install cargo-expand

# In your program directory
cargo expand | grep "YourCircuitOutput" -A 20
```

This shows exactly what structs were generated for your circuit.

You can also search the full output:

```bash  theme={null}
cargo expand > expanded.rs
# Then search expanded.rs for your circuit name
```

## Array and Complex Type Handling

### Fixed-Size Arrays

When your circuit returns arrays, each element becomes a separate scalar in the LEN count:

```rust  theme={null}
#[instruction]
pub fn process_batch() -> Enc<Shared, [u32; 3]> {
    // Process multiple values at once
    [result1, result2, result3]
}
```

This generates `SharedEncryptedStruct<3>` because the array has 3 elements:

```rust  theme={null}
pub struct ProcessBatchOutput {
    pub field_0: SharedEncryptedStruct<3>, // Array of 3 u32s
}
```

In your callback, access individual elements:

```rust  theme={null}
let encrypted_array = result.field_0;
let first_element = encrypted_array.ciphertexts[0];   // result1
let second_element = encrypted_array.ciphertexts[1];  // result2
let third_element = encrypted_array.ciphertexts[2];   // result3
```

### Nested Structures

For deeply nested data, LEN counts **all scalar values** at any depth:

```rust  theme={null}
pub struct Position {
    pub x: u32,
    pub y: u32,
}

pub struct Entity {
    pub position: Position,  // 2 scalars (x, y)
    pub health: u32,         // 1 scalar
    pub alive: bool,         // 1 scalar
}
// Total: 2 + 1 + 1 = 4 scalars

#[instruction]
pub fn update_entity() -> Enc<Shared, Entity> { /* ... */ }
```

Result: `SharedEncryptedStruct<4>` because Entity contains 4 total scalar values.

## Migration from v0.1.x

If you're upgrading from an older version, the new type generation system replaces manual byte parsing:

**Old way (v0.1.x)**:

```rust  theme={null}
pub fn encrypted_ix_callback(output: ComputationOutputs) -> Result<()> {
    let bytes = if let ComputationOutputs::Bytes(bytes) = output {
        bytes
    } else {
        return Err(ErrorCode::AbortedComputation.into());
    };

    let sum = bytes[48..80].try_into().unwrap();
    let nonce = bytes[32..48].try_into().unwrap();
    // ...
}
```

**New way (current)**:

```rust  theme={null}
pub fn encrypted_ix_callback(
    ctx: Context<AddTogetherCallback>,
    output: SignedComputationOutputs<AddTogetherOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account
    ) {
        Ok(AddTogetherOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };

    let sum = o.ciphertexts[0];
    let nonce = o.nonce;
    // ...
}
```

For detailed migration steps, see the [Migration Guide](/developers/migration).

## Type Generation Limitations

### Supported Return Types

The type generation system works with most common Rust types, but has some constraints:

**✅ Supported:**

* Primitive types: `u8`, `u16`, `u32`, `u64`, `u128`, `i8`, `i16`, `i32`, `i64`, `i128`, `bool`
* Fixed-size arrays: `[T; N]` where N is a compile-time constant
* Tuples: `(T, U, V)` with any number of elements
* Custom structs with supported field types
* Nested combinations of the above

**❌ Not Supported:**

* Dynamic types: `Vec<T>`, `String`, `HashMap<K, V>`
* Reference types: `&T`, `&mut T` (except for input parameters)
* Generic types with lifetime parameters
* Recursive or self-referencing structs
* `Option<T>` or `Result<T, E>` as return types

### Practical Constraints

**Size Limitations:**

* Very large structs (1000+ fields) may impact compilation time
* Arrays with thousands of elements create correspondingly large LEN values
* Deep nesting (10+ levels) may cause macro expansion issues

**Naming Conflicts:**

```rust  theme={null}
// This would create a conflict:
#[instruction] pub fn test() -> u32        // → TestOutput
#[instruction] pub fn TEST() -> u32        // → TestOutput (same name!)
```

Function names must be unique when converted to PascalCase + "Output".

### Working Within Constraints

If you need unsupported types, consider these patterns:

```rust  theme={null}
// Instead of Vec<u32>, use fixed arrays:
#[instruction]
pub fn process() -> Enc<Shared, [u32; 10]> { /* ... */ }

// Instead of Option<T>, use a flag + value:
#[instruction]
pub fn maybe_compute() -> (Enc<Shared, bool>, Enc<Shared, u32>) {
    // (has_value, value)
}

// Instead of String, use fixed-size byte arrays:
#[instruction]
pub fn get_name() -> Enc<Shared, [u8; 32]> { /* ... */ }
```

## Common Patterns and Performance Tips

### Choosing the Right Encryption Type

* **Use `Enc<Shared, T>`** when users need to decrypt and verify results (votes, game outcomes, personal data)
* **Use `Enc<Mxe, T>`** for internal state that users shouldn't access (system secrets, aggregate statistics, protocol data)

### Performance Considerations

* **Large arrays**: `[u8; 1000]` becomes `SharedEncryptedStruct<1000>` - consider if you really need all elements encrypted
* **Complex nesting**: Deep struct hierarchies increase LEN values - flatten when possible
* **Mixed returns**: `(Enc<Shared, T>, Enc<Mxe, U>)` creates separate encrypted structs for optimal access patterns

### Testing Your Callbacks

Mock the computation outputs for testing:

```rust  theme={null}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_callback_success() {
        let mock_output = ComputationOutputs::Success(YourCircuitOutput {
            field_0: SharedEncryptedStruct {
                encryption_key: [0u8; 32],
                nonce: 12345u128,
                ciphertexts: [[1u8; 32]],
            },
        });

        // Test your callback logic
        assert!(your_callback(mock_output).is_ok());
    }
}
```

## Quick Reference

| Return Type      | Generated Struct           | Access Pattern                          |
| ---------------- | -------------------------- | --------------------------------------- |
| `Enc<Shared, T>` | `SharedEncryptedStruct<1>` | `result.ciphertexts[0]`, `result.nonce` |
| `Enc<Mxe, T>`    | `MXEEncryptedStruct<1>`    | `result.ciphertexts[0]`, `result.nonce` |
| `(T, U, V)`      | `{Circuit}OutputStruct0`   | `result.field_0`, `result.field_1`      |
| Custom struct    | `{Circuit}OutputStruct0`   | `result.field_0`, `result.field_1`      |

**Callback pattern:**

```rust  theme={null}
#[arcium_callback(encrypted_ix = "your_function")]
pub fn callback(
    ctx: Context<YourFunctionCallback>,
    output: SignedComputationOutputs<YourFunctionOutput>,
) -> Result<()> {
    let o = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account
    ) {
        Ok(YourFunctionOutput { field_0 }) => field_0,
        Err(_) => return Err(ErrorCode::AbortedComputation.into()),
    };
    // Access o.ciphertexts[0], o.nonce.to_le_bytes(), etc.
}
```

***

The callback type generation system automatically handles encrypted computation results, eliminating manual byte parsing and offset tracking. With properly typed structs, you can work directly with structured data and focus on building your applications rather than handling low-level data conversion.

These generated types provide type safety and predictable patterns that make working with encrypted computation outputs straightforward and reliable.


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
