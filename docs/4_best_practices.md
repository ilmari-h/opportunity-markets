# Best practices

We provide here a set of miscellaneous tips and tricks and things to keep in mind when writing confidential instructions and programs.

## Execution flow

While we strive to make the Arcis compiler accept inputs that are as close as possible to standard rust code, there are some differences. Fundamentally, this is because code emitted by the Arcis compiler will not depend on the value of private inputs and so must be data independent (Intuitively, this makes sense. If the execution flow of our code depended on the value of a private input, an external observer could use this to learn information about the private values). We highlight here a few examples to keep in mind.

* If/else statements. We would normally not be able to use a masked value in the condition of an if statement. The Arcis compiler will however interpret this correctly and rewrite it into a data independent form. Since this is done by a macro, some syntax valid for the rust compiler will not be accepted (missing else branch, or else if clauses). Additionally, you will not gain any performance from using a masked value in the condition of an if statement: the program will still execute both branches, and just not use the result of the branch that is not taken.
* In general, control flow behavior that depends on a masked value is not supported. This includes early returns, or break statements in for loops, for example. A good rule of thumb is that the execution flow should be the same, no matter what value is masked.
* Currently, variable sized types such as `Vec<T>` are also not supported as length of the data should be known at compile time.

## Operations

Arcium supports multiple MPC backends, but all are based on additive-secret sharing. This has a few implications on what operations are more and less expensive, so we present a few guidelines below. Of course, performance always depends on the exact circuit. These are heuristic and not rules.

* Multiplications between secret values are significantly more expensive than on plaintext, as they involve heavy pre-processing and communication. - Multiplications between a secret and a plaintext value, as well as additions between secret/plaintext values, are basically free and run at pretty much the same speed as on plaintext data.
* Comparisons require conversion from Scalars to arrays of boolean bits which we then compare element-wise. This is a relatively expensive operation. A good rule of thumb is therefore the ordering of performance (where additions is the cheapest operation) is additions -> multiplications -> comparisons.


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.arcium.com/llms.txt
