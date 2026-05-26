import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

export const publicClient = createPublicClient({
  chain: base,
  transport: http(rpcUrl),
});
