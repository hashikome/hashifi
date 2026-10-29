import { generateKeyPairSync } from "node:crypto";
import { rosQuote } from "./bootstrap.js";

/**
 * The management tunnel: a WireGuard interface the router opens to the platform, so the API
 * can reach a router behind NAT (or carrier-grade NAT) without any inbound port at the venue.
 *
 * The router dials out and keeps the path open with a keepalive; the API connects to the
 * router's tunnel address. The router's key pair is generated here and its private key travels
 * in the pasted bootstrap script, as the API password already does; only the public key needs
 * to be kept. ADR-0006 records the design.
 */
export interface ManagementTunnel {
  /** The router's private key, base64. */
  routerPrivateKey: string;
  /** The router's tunnel address with the tunnel network's prefix, e.g. "10.88.0.2/24". */
  routerAddress: string;
  /** The platform's public key, base64. */
  serverPublicKey: string;
  /** The platform's tunnel address, e.g. "10.88.0.1": the only source the router's API accepts. */
  serverAddress: string;
  /** Where the router dials: a host name or address, and a UDP port. */
  endpointHost: string;
  endpointPort: number;
}

export const TUNNEL_INTERFACE = "hashifi-mgmt";
/** Keeps NAT mappings open; RouterOS and WireGuard both recommend 25 s. */
const KEEPALIVE = "25s";

export interface WireguardKeyPair {
  privateKey: string;
  publicKey: string;
}

/** A WireGuard (X25519) key pair, base64-encoded as `wg genkey` / `wg pubkey` print them. */
export function generateWireguardKeyPair(): WireguardKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const privateJwk = privateKey.export({ format: "jwk" });
  const publicJwk = publicKey.export({ format: "jwk" });
  if (!privateJwk.d || !publicJwk.x) throw new Error("X25519 key export returned no key");
  return { privateKey: base64UrlToBase64(privateJwk.d), publicKey: base64UrlToBase64(publicJwk.x) };
}

function base64UrlToBase64(value: string): string {
  return Buffer.from(value, "base64url").toString("base64");
}

/** Bootstrap statements that bring the tunnel up; each is self-contained and safe to repeat. */
export function tunnelLines(tunnel: ManagementTunnel): string[] {
  const iface = TUNNEL_INTERFACE;
  const privateKey = rosQuote(tunnel.routerPrivateKey);
  const publicKey = rosQuote(tunnel.serverPublicKey);
  const endpoint = `endpoint-address=${tunnel.endpointHost} endpoint-port=${tunnel.endpointPort}`;
  const peer = `public-key="${publicKey}" ${endpoint} allowed-address=${tunnel.serverAddress}/32 persistent-keepalive=${KEEPALIVE}`;
  return [
    `:if ([:len [/interface wireguard find where name="${iface}"]] = 0) do={/interface wireguard add name=${iface} private-key="${privateKey}"} else={/interface wireguard set [find where name="${iface}"] private-key="${privateKey}"}`,
    `:if ([:len [/ip address find where address="${tunnel.routerAddress}" interface=${iface}]] = 0) do={/ip address add address=${tunnel.routerAddress} interface=${iface}}`,
    // Two statements, not one add-or-set: repeating every parameter in both branches overran the
    // console's 512-character line even with a short endpoint name.
    `:if ([:len [/interface wireguard peers find where interface=${iface}]] = 0) do={/interface wireguard peers add interface=${iface} public-key="${publicKey}" allowed-address=${tunnel.serverAddress}/32}`,
    `/interface wireguard peers set [find where interface=${iface}] ${peer}`,
  ];
}
