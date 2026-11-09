import type { ClusterMoniker } from "./solana-client";

export function getExplorerUrl(path: string, cluster: ClusterMoniker): string {
  const base = "https://explorer.solana.com";
  const url = new URL(path, base);

  if (cluster !== "mainnet") {
    if (cluster === "localnet") {
      url.searchParams.set("cluster", "custom");
      url.searchParams.set("customUrl", "http://localhost:8899");
    } else {
      url.searchParams.set("cluster", cluster);
    }
  }

  return url.toString();
}

export function ellipsify(str: string, chars = 4): string {
  if (str.length <= chars * 2 + 3) return str;
  return `${str.slice(0, chars)}...${str.slice(-chars)}`;
}

/** Orb (Helius's explorer). The app runs on devnet; the cluster comes from NEXT_PUBLIC_SOLANA_CLUSTER when set. */
const ORB = "https://orbmarkets.io";
const ORB_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet";
const orbSuffix = ORB_CLUSTER === "mainnet" || ORB_CLUSTER === "mainnet-beta" ? "" : `?cluster=${ORB_CLUSTER}`;

export const orbTxUrl = (signature: string) => `${ORB}/tx/${signature}${orbSuffix}`;
export const orbAddressUrl = (address: string) => `${ORB}/address/${address}${orbSuffix}`;
