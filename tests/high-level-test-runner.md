I want to rewrite our tests so that they are more declarative and concise in nature.

Instead of having to worry about forming transaction data, sending transaction and confirming transaction,  I want a higher level interface abstracted under a class called TestRunner

example code would look like

```
const optionAccount = await TestRunner.addOption(userId, "Option name")
```

Inside of test runner we store things like user x25519 keypairs and solana keypairs. All we need to tell the test runner is the ID of the user (their solana pubkey) and the method will handle the rest inside of its body.

Create the `TestRunner` class with at least following methods

fundMarket

openMarket

initVoteTokenAccount

mintVoteTokens

addMarketOption

buyShares

buySharesBatch (where we can buy shares for multiple users at a time, at different amounts, one arg must be user array with IDs and amounts)

selectOption


revealShares

revealSharesBatch

incrementOptionTally

incrementOptionTallyBatch

closeShareAccount

closeShareAccountBatch


For the batch methods, implement the batch method first and in the non-batch variant, call the batch method with array of length 1

for all code, use Solana kit types and our own bindings from the directory js/

create the plan