import { type TransactionSigner, type Instruction } from "@solana/kit";
import {
  fetchMaybePlatformConfig,
  getUpdatePlatformConfigInstruction,
} from "../generated";
import { getPlatformConfigAddress } from "../accounts/platformConfig";
import { type BaseInstructionParams } from "./instructionParams";

export interface UpdatePlatformConfigParams extends BaseInstructionParams {
  signer: TransactionSigner;
  name: string;
  platformFeeBp: number;
  rewardPoolFeeBp: number;
  creatorFeeBp: number;
  minTimeToStakeSeconds: bigint;
  minTimeToRevealSeconds: bigint;
  maxSelectOptionsSeconds: bigint;
}

export async function updatePlatformConfig(
  rpc: Parameters<typeof fetchMaybePlatformConfig>[0],
  params: UpdatePlatformConfigParams,
): Promise<Instruction> {
  const {
    programAddress,
    signer,
    name,
    platformFeeBp,
    rewardPoolFeeBp,
    creatorFeeBp,
    minTimeToStakeSeconds,
    minTimeToRevealSeconds,
    maxSelectOptionsSeconds,
  } = params;

  const [platformConfigAddress] = await getPlatformConfigAddress(
    signer.address,
    name,
    programAddress,
  );
  const existing = await fetchMaybePlatformConfig(rpc, platformConfigAddress);
  if (!existing.exists) {
    throw new Error(
      `Platform config does not exist for (${signer.address}, "${name}") at ${platformConfigAddress}`,
    );
  }

  return getUpdatePlatformConfigInstruction(
    {
      updateAuthority: signer,
      platformConfig: platformConfigAddress,
      platformFeeBp,
      rewardPoolFeeBp,
      creatorFeeBp,
      minTimeToStakeSeconds,
      minTimeToRevealSeconds,
      maxSelectOptionsSeconds,
    },
    programAddress ? { programAddress } : undefined,
  ) as Instruction;
}
