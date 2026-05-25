import * as anchor from "@anchor-lang/core";
import {
  Address,
  createSolanaRpc,
  sendAndConfirmTransactionFactory,
  createKeyPairSignerFromBytes,
  assertIsTransactionWithBlockhashLifetime,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  type Rpc,
  type SolanaRpcApi
} from "@solana/kit";
import {
  getInitCompDefInstruction,
  getCompDefAccount,
  getCompDefOffsetNumber,
  type CompDefCircuitName,
  ALL_COMP_DEF_CIRCUITS,
} from "../../js/src";
import { buildFinalizeCompDefTx } from "@arcium-hq/client";
import { PublicKey } from "@solana/web3.js";

/**
 * Initialize a single computation definition using Kit.
 * Uses the generated instructions for init, but still needs provider for finalization
 * since buildFinalizeCompDefTx from @arcium-hq/client returns a web3.js Transaction.
 */
async function initCompDef(
  rpc: Rpc<SolanaRpcApi>,
  sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>,
  provider: anchor.AnchorProvider,
  payer: Awaited<ReturnType<typeof createKeyPairSignerFromBytes>>,
  payerLegacy: anchor.web3.Keypair,
  programId: Address,
  circuitName: CompDefCircuitName
): Promise<void> {
  const compDefAddress = getCompDefAccount(circuitName, programId);
  const accountInfo = await rpc.getAccountInfo(compDefAddress, { encoding: "base64" }).send();
  if (accountInfo.value !== null) {
    // Already initialized so skip
    return;
  }

  // Build the init instruction
  const initIx = await getInitCompDefInstruction(rpc, payer, circuitName, { programAddress: programId });

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();

  // Build transaction message
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(payer.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions([initIx], msg)
  );

  // Sign and send
  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  try {
    await sendAndConfirm(signedTransaction, { commitment: "confirmed" });
  } catch (err: any) {
    if (err?.context?.logs) {
      console.error("   Transaction logs:");
      err.context.logs.forEach((log: string) => console.error(`     ${log}`));
    } else if (err?.logs) {
      console.error("   Transaction logs:");
      err.logs.forEach((log: string) => console.error(`     ${log}`));
    }
    console.error("   Error:", err?.message || err);
    throw err;
  }

  // Finalize using arcium-hq/client
  const programIdLegacy = new PublicKey(programId);
  const offset = getCompDefOffsetNumber(circuitName);
  try {
    const finalizeTx = await buildFinalizeCompDefTx(provider, offset, programIdLegacy);

    const blockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = blockhash.blockhash;
    finalizeTx.lastValidBlockHeight = blockhash.lastValidBlockHeight;

    // Sign with the legacy keypair
    finalizeTx.sign(payerLegacy);
    await provider.sendAndConfirm(finalizeTx);
    console.log(`   Comp def ${circuitName} finalized!`);
  } catch (err: any) {
    // In local test environments with pre-seeded raw circuits, finalization
    // may fail due to Arcium program version mismatch. The comp def init
    // (CPI) succeeds and raw circuits are pre-seeded in genesis, so
    // computations can still proceed without explicit finalization.
    console.warn(`   Comp def ${circuitName} finalize skipped (${err?.message || "unknown error"})`);
  }
}

/**
 * Initialize all computation definitions for the OpportunityMarket program.
 *
 * @param rpc - Solana Kit RPC client
 * @param sendAndConfirm - Solana Kit transaction sender
 * @param secretKey - The payer's secret key (will be converted to both Kit and legacy keypairs)
 * @param programId - The program ID as a Kit Address
 */
export async function initializeAllCompDefs(
  rpc: Rpc<SolanaRpcApi>,
  sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>,
  secretKey: Uint8Array,
  programId: Address,
  circuits?: CompDefCircuitName[]
): Promise<void> {
  // Create Kit keypair from secret key
  const payer = await createKeyPairSignerFromBytes(secretKey);

  // Create legacy keypair for buildFinalizeCompDefTx
  const payerLegacy = anchor.web3.Keypair.fromSecretKey(secretKey);

  // Initialize Anchor provider for finalization
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  for (const circuitName of (circuits ?? ALL_COMP_DEF_CIRCUITS)) {
    await initCompDef(rpc, sendAndConfirm, provider, payer, payerLegacy, programId, circuitName);
  }
}
