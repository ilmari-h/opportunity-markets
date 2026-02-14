import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  address,
  airdropFactory,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  lamports,
  sendAndConfirmTransactionFactory,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  awaitComputationFinalization,
  initVoteTokenAccount,
  mintVoteTokens,
  claimVoteTokens,
  randomComputationOffset,
  fetchVoteTokenAccount,
  getVoteTokenAccountAddress,
} from "../js/src";
import { initializeAllCompDefs } from "./utils/comp-defs";
import { sendTransaction } from "./utils/transaction";
import { createMintAndFundAccount } from "./utils/spl-token";
import { nonceToBytes } from "./utils/nonce";
import { getArciumEnv, getMXEPublicKey, deserializeLE } from "@arcium-hq/client";
import { OpportunityMarket } from "../target/types/opportunity_market";
import * as fs from "fs";
import * as os from "os";
import { randomBytes } from "crypto";
import { generateX25519Keypair, createCipher } from "../js/src/x25519/keypair";
import { expect } from "chai";

const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
const WS_URL = RPC_URL.replace("http", "ws").replace(":8899", ":8900");

describe("Vote Token Account (SPL)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.OpportunityMarket as Program<OpportunityMarket>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const programId = address(program.programId.toBase58());
  const arciumEnv = getArciumEnv();

  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
  const airdrop = airdropFactory({ rpc, rpcSubscriptions });
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  let mxePublicKey: Uint8Array;

  before(async () => {
    const file = fs.readFileSync(`${os.homedir()}/.config/solana/id.json`);
    const secretKey = new Uint8Array(JSON.parse(file.toString()));
    await initializeAllCompDefs(rpc, sendAndConfirm, secretKey, programId);
    mxePublicKey = await getMXEPublicKey(provider, program.programId);
  });

  /**
   * Fetches the VTA from chain and decrypts the encrypted balance.
   */
  async function decryptVtaBalance(
    vtaAddress: Parameters<typeof fetchVoteTokenAccount>[1],
    userSecretKey: Uint8Array,
  ): Promise<bigint> {
    const vta = await fetchVoteTokenAccount(rpc, vtaAddress);
    const cipher = createCipher(userSecretKey, mxePublicKey);
    const nonceBytes = nonceToBytes(vta.data.stateNonce);
    const decrypted = cipher.decrypt(vta.data.encryptedState, nonceBytes);
    return decrypted[0];
  }

  it("can init VTA, mint vote tokens, and claim them back", async () => {
    // Generate a user keypair and airdrop SOL for fees
    const user = await generateKeyPairSigner();
    await airdrop({
      recipientAddress: user.address,
      lamports: lamports(2_000_000_000n),
      commitment: "confirmed",
    });

    // Create an SPL token mint and fund the user's ATA with tokens
    const splAmount = 100_000_000n;
    const { mint, ata: userAta } = await createMintAndFundAccount(
      rpc,
      sendAndConfirm,
      user,
      user.address,
      splAmount,
    );

    // Generate x25519 keypair for encryption
    const keypair = generateX25519Keypair();

    // Init vote token account (no MPC needed - just creates empty account)
    const initVtaIx = await initVoteTokenAccount({
      signer: user,
      tokenMint: mint.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      userPubkey: keypair.publicKey,
    });

    await sendTransaction(rpc, sendAndConfirm, user, [initVtaIx], {
      label: "initVoteTokenAccount",
    });

    // Verify VTA was created with correct owner and mint
    const [vtaAddress] = await getVoteTokenAccountAddress(mint.address, user.address, programId);
    const vtaAccount = await fetchVoteTokenAccount(rpc, vtaAddress);
    expect(vtaAccount.data.owner).to.equal(user.address);
    expect(vtaAccount.data.tokenMint).to.equal(mint.address);
    // Means not initialized
    expect(vtaAccount.data.stateNonce).to.equal(0n);

    // Mint vote tokens (transfers SPL tokens from user ATA -> VTA's ATA, updates encrypted balance)
    const voteTokenAmount = 50_000_000n;
    const mintOffset = randomComputationOffset();

    const mintVtIx = await mintVoteTokens(
      {
        signer: user,
        tokenMint: mint.address,
        voteTokenAccount: vtaAddress,
        signerTokenAccount: userAta,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        amount: voteTokenAmount,
      },
      {
        clusterOffset: arciumEnv.arciumClusterOffset,
        computationOffset: mintOffset,
      },
    );

    await sendTransaction(rpc, sendAndConfirm, user, [mintVtIx], {
      label: "mintVoteTokens",
    });
    await awaitComputationFinalization(rpc, mintOffset);

    // Verify encrypted balance equals minted amount
    const balanceAfterMint = await decryptVtaBalance(vtaAddress, keypair.secretKey);
    expect(balanceAfterMint).to.equal(voteTokenAmount);

    // Claim vote tokens back (transfers SPL tokens from VTA's ATA -> user ATA, updates encrypted balance)
    const claimAmount = 25_000_000n;
    const claimOffset = randomComputationOffset();

    const claimVtIx = await claimVoteTokens(
      {
        signer: user,
        tokenMint: mint.address,
        voteTokenAccount: vtaAddress,
        userTokenAccount: userAta,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        amount: claimAmount,
      },
      {
        clusterOffset: arciumEnv.arciumClusterOffset,
        computationOffset: claimOffset,
      },
    );

    await sendTransaction(rpc, sendAndConfirm, user, [claimVtIx], {
      label: "claimVoteTokens",
    });
    await awaitComputationFinalization(rpc, claimOffset);

    // Verify encrypted balance decreased by claimed amount
    const balanceAfterClaim = await decryptVtaBalance(vtaAddress, keypair.secretKey);
    expect(balanceAfterClaim).to.equal(voteTokenAmount - claimAmount);
  });
});
