import {
  type Address,
  type KeyPairSigner,
  generateKeyPairSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getInitializeMintInstruction,
  getMintSize,
  getMintToInstruction,
  getCreateAssociatedTokenInstructionAsync,
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { sendTransaction, type RpcClient, type SendAndConfirmFn } from "./transaction";

/**
 * Creates a new SPL token mint.
 *
 * @returns The mint KeyPairSigner (address accessible via `.address`)
 */
export async function createTokenMint(
  rpc: RpcClient,
  sendAndConfirm: SendAndConfirmFn,
  payer: KeyPairSigner,
  mintAuthority: Address,
  decimals: number = 0,
): Promise<KeyPairSigner> {
  const mint = await generateKeyPairSigner();
  const space = BigInt(getMintSize());
  const rent = await rpc.getMinimumBalanceForRentExemption(space).send();

  const createAccountIx = getCreateAccountInstruction({
    payer,
    newAccount: mint,
    lamports: rent,
    space,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  });

  const initMintIx = getInitializeMintInstruction({
    mint: mint.address,
    decimals,
    mintAuthority,
  });

  await sendTransaction(rpc, sendAndConfirm, payer, [createAccountIx, initMintIx], {
    label: "Create token mint",
  });

  return mint;
}

/**
 * Creates an Associated Token Account for a given owner and mint.
 *
 * @returns The ATA address
 */
export async function createAta(
  rpc: RpcClient,
  sendAndConfirm: SendAndConfirmFn,
  payer: KeyPairSigner,
  mint: Address,
  owner: Address,
): Promise<Address> {
  const createAtaIx = await getCreateAssociatedTokenInstructionAsync({
    payer,
    mint,
    owner,
  });

  await sendTransaction(rpc, sendAndConfirm, payer, [createAtaIx], {
    label: "Create ATA",
  });

  const [ataAddress] = await findAssociatedTokenPda({
    mint,
    owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  return ataAddress;
}

/**
 * Mints SPL tokens to a destination token account.
 *
 * The payer must be the mint authority.
 */
export async function mintTokensTo(
  rpc: RpcClient,
  sendAndConfirm: SendAndConfirmFn,
  mintAuthority: KeyPairSigner,
  mint: Address,
  destination: Address,
  amount: bigint,
): Promise<void> {
  const mintToIx = getMintToInstruction({
    mint,
    token: destination,
    mintAuthority,
    amount,
  });

  await sendTransaction(rpc, sendAndConfirm, mintAuthority, [mintToIx], {
    label: `Mint ${amount} tokens`,
  });
}

/**
 * Convenience: creates a mint, creates an ATA for the owner, and mints tokens into it.
 *
 * @returns { mint, ata } - the mint signer and the ATA address
 */
export async function createMintAndFundAccount(
  rpc: RpcClient,
  sendAndConfirm: SendAndConfirmFn,
  payer: KeyPairSigner,
  owner: Address,
  amount: bigint,
  decimals: number = 0,
): Promise<{ mint: KeyPairSigner; ata: Address }> {
  const mint = await createTokenMint(rpc, sendAndConfirm, payer, payer.address, decimals);
  const ata = await createAta(rpc, sendAndConfirm, payer, mint.address, owner);
  await mintTokensTo(rpc, sendAndConfirm, payer, mint.address, ata, amount);
  return { mint, ata };
}

export { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda };
