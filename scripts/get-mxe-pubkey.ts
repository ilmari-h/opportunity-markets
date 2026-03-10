import { getMXEPublicKey } from "@arcium-hq/client";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

if (!process.env.PROGRAM_ID) throw new Error("PROGRAM_ID env var is required");
if (!process.env.RPC_URL) throw new Error("RPC_URL env var is required");

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID);
const RPC_URL = process.env.RPC_URL;

function readSecretKey(path: string): Uint8Array {
  const file = fs.readFileSync(path);
  return new Uint8Array(JSON.parse(file.toString()));
}

async function main() {
  const keypairPath =
    process.env.DEPLOYER_KEYPAIR_PATH ||
    `${os.homedir()}/.config/solana/id.json`;
  const secretKey = readSecretKey(keypairPath);
  const wallet = new Wallet(Keypair.fromSecretKey(secretKey));

  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const mxePublicKey = await getMXEPublicKey(provider, PROGRAM_ID);
  if (!mxePublicKey) {
    console.error("MXE public key not found (not yet set on-chain).");
    process.exit(1);
  }

  console.log(Buffer.from(mxePublicKey).toString("hex"));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
