import * as fs from "fs";
import * as os from "os";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

let cached: KeyPairSigner | null = null;

export async function getDeployerKeypair(): Promise<KeyPairSigner> {
  if (cached) return cached;
  const file = fs.readFileSync(`${os.homedir()}/.config/solana/id.json`);
  const secretKey = new Uint8Array(JSON.parse(file.toString()));
  cached = await createKeyPairSignerFromBytes(secretKey);
  return cached;
}
