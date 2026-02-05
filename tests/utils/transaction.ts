import {
  type Instruction,
  type TransactionSigner,
  type Signature,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  createSolanaRpc,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";

/** JSON.stringify replacer that handles BigInt values */
function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export type RpcClient = ReturnType<typeof createSolanaRpc>;
export type SendAndConfirmFn = ReturnType<typeof sendAndConfirmTransactionFactory>;

export interface SendTransactionOptions {
  /** Label for logging (e.g., "Fund market", "Open market") */
  label?: string;
  /** Whether to print simulation logs (default: true) */
  printLogs?: boolean;
  /** Commitment level (default: "confirmed") */
  commitment?: "processed" | "confirmed" | "finalized";
}

export interface SendTransactionResult {
  signature: Signature;
  logs: readonly string[] | undefined;
}

/**
 * Helper to build, sign, simulate, and send a transaction.
 *
 * This handles all the boilerplate for Kit transactions:
 * 1. Fetches latest blockhash
 * 2. Builds transaction message with fee payer and instructions
 * 3. Signs with all signers extracted from instructions
 * 4. Simulates and logs results
 * 5. Sends and confirms
 *
 * @param rpc - Solana RPC client
 * @param sendAndConfirm - sendAndConfirmTransactionFactory result
 * @param feePayer - Transaction signer who pays fees
 * @param instructions - Array of instructions to include
 * @param options - Optional configuration
 * @returns Signature and logs from the transaction
 */
export async function sendTransaction(
  rpc: RpcClient,
  sendAndConfirm: SendAndConfirmFn,
  feePayer: TransactionSigner,
  instructions: Instruction[],
  options: SendTransactionOptions = {}
): Promise<SendTransactionResult> {
  const { label, printLogs = false, commitment = "confirmed" } = options;
  const logPrefix = label ? `   [${label}] ` : "   ";

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment }).send();

  // Build transaction message
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(feePayer.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions(instructions, msg)
  );

  // Sign the transaction
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);

  // Simulate
  if (printLogs) {
    console.log(`${logPrefix}Simulating...`);
  }

  const base64Tx = getBase64EncodedWireTransaction(signedTransaction);
  const simResult = await rpc.simulateTransaction(base64Tx, {
    commitment,
    encoding: "base64",
  }).send();

  const logs = simResult.value.logs;

  if (printLogs || simResult.value.err) {
    const logFunc = simResult.value.err ? console.error : console.log
      logFunc(`${logPrefix}Simulation:`, simResult.value.err);
    if (logs) {
      logFunc(`${logPrefix}Logs:`);
      logs.forEach((log) => logFunc(`${logPrefix}  ${log}`));
    }
  }

  if (simResult.value.err) {
    throw new Error(
      `${label ? `${label}: ` : ""}Simulation failed: ${JSON.stringify(simResult.value.err, bigIntReplacer)}`
    );
  }

  // Send and confirm
  if (printLogs) {
    console.log(`${logPrefix}Sending...`);
  }

  await sendAndConfirm(signedTransaction, { commitment });
  const signature = getSignatureFromTransaction(signedTransaction);

  // Fetch transaction to verify instruction succeeded (not just tx confirmed)
  const txResult = await rpc.getTransaction(signature, {
    commitment,
    maxSupportedTransactionVersion: 0,
    encoding: "jsonParsed"
  }).send();

  if (txResult?.meta?.err) {
    const txLogs = txResult.meta.logMessages || [];
    console.error(`${logPrefix}Transaction confirmed but instruction failed!`);
    console.error(`${logPrefix}Error:`, txResult.meta.err);
    txLogs.forEach((log) => console.error(`${logPrefix}  ${log}`));
    throw new Error(
      `${label ? `${label}: ` : ""}Instruction failed: ${JSON.stringify(txResult.meta.err, bigIntReplacer)}`
    );
  }

  if (printLogs) {
    console.log(`${logPrefix}Confirmed: ${signature.slice(0, 20)}...`);
  }

  return { signature, logs };
}

/**
 * Simulate a transaction without sending it.
 * Useful for checking if a transaction would succeed.
 */
export async function simulateTransaction(
  rpc: RpcClient,
  feePayer: TransactionSigner,
  instructions: Instruction[],
  options: Omit<SendTransactionOptions, "printLogs"> & { printLogs?: boolean } = {}
): Promise<{ success: boolean; logs: readonly string[] | undefined; error: unknown }> {
  const { label, printLogs = false, commitment = "confirmed" } = options;
  const logPrefix = label ? `   [${label}] ` : "   ";

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment }).send();

  // Build transaction message
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(feePayer.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions(instructions, msg)
  );

  // Sign the transaction
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);

  // Simulate
  if (printLogs) {
    console.log(`${logPrefix}Simulating...`);
  }

  const base64Tx = getBase64EncodedWireTransaction(signedTransaction);
  const simResult = await rpc.simulateTransaction(base64Tx, {
    commitment,
    encoding: "base64",
  }).send();

  const logs = simResult.value.logs;

  if (printLogs) {
    console.log(`${logPrefix}Simulation error:`, simResult.value.err);
    if (logs) {
      console.log(`${logPrefix}Logs:`);
      logs.forEach((log) => console.log(`${logPrefix}  ${log}`));
    }
  }

  return {
    success: simResult.value.err === null,
    logs,
    error: simResult.value.err,
  };
}
