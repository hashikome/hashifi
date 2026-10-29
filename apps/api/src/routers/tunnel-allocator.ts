import type { SecretBox } from "../crypto/secret-box.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { intToIpv4, ipv4ToInt } from "../services/router-provision/ipv4.js";
import { generateWireguardKeyPair } from "../services/router-provision/tunnel.js";

/** The platform side of the management tunnel (ADR-0006). */
export interface TunnelPlatform {
  /** The tunnel network in CIDR, e.g. "10.88.0.0/16". Its first host is the platform. */
  network: string;
}

export interface RouterTunnel {
  routerAddress: string;
  prefix: number;
  routerPublicKey: string;
  /** Opened from its sealed form, for the bootstrap script only. */
  routerPrivateKey: string;
}

/** The PostgreSQL advisory lock that serialises tunnel allocations (any fixed number). */
const ALLOCATION_LOCK = 880_001;

/**
 * Gives each router a tunnel address and key pair, once. The private key is stored sealed so
 * the bootstrap script can be regenerated without orphaning the key already pasted on the
 * router; the address is unique per router.
 */
export class TunnelAllocator {
  private readonly base: number;
  private readonly prefix: number;
  private readonly size: number;

  constructor(
    private readonly db: PrismaClient,
    private readonly box: SecretBox,
    platform: TunnelPlatform,
  ) {
    const [address, prefix] = platform.network.split("/");
    const base = address ? ipv4ToInt(address) : null;
    const bits = Number(prefix);
    if (base === null || !Number.isInteger(bits) || bits < 8 || bits > 29) {
      throw new Error(`Invalid tunnel network: ${platform.network}`);
    }
    this.prefix = bits;
    this.size = 2 ** (32 - bits);
    this.base = (base & ((0xffffffff << (32 - bits)) >>> 0)) >>> 0;
  }

  /** The platform's own address in the tunnel: the network's first host. */
  get platformAddress(): string {
    return intToIpv4(this.base + 1);
  }

  /**
   * The router's tunnel, allocating it on first use. Allocations take a transaction lock, so
   * concurrent ones queue instead of all choosing the same lowest free address; the unique
   * index on the address remains the guarantee.
   */
  async allocate(routerId: string): Promise<RouterTunnel> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${ALLOCATION_LOCK})`;
      const router = await tx.router.findUniqueOrThrow({ where: { id: routerId } });
      if (router.tunnelAddress && router.tunnelPublicKey && router.tunnelPrivateKeyEncrypted) {
        return {
          routerAddress: router.tunnelAddress,
          prefix: this.prefix,
          routerPublicKey: router.tunnelPublicKey,
          routerPrivateKey: this.box.open(router.tunnelPrivateKeyEncrypted),
        };
      }
      const address = await this.nextFreeAddress(tx);
      const keys = generateWireguardKeyPair();
      await tx.router.update({
        where: { id: routerId },
        data: {
          tunnelAddress: address,
          tunnelPublicKey: keys.publicKey,
          tunnelPrivateKeyEncrypted: this.box.seal(keys.privateKey),
        },
      });
      return { routerAddress: address, prefix: this.prefix, ...routerKeys(keys) };
    });
  }

  private async nextFreeAddress(tx: Prisma.TransactionClient): Promise<string> {
    const taken = new Set(
      (
        await tx.router.findMany({
          where: { tunnelAddress: { not: null } },
          select: { tunnelAddress: true },
        })
      ).flatMap((r) => (r.tunnelAddress ? [r.tunnelAddress] : [])),
    );
    // .0 is the network and .1 the platform; the last address is broadcast.
    for (let offset = 2; offset < this.size - 1; offset++) {
      const candidate = intToIpv4(this.base + offset);
      if (!taken.has(candidate)) return candidate;
    }
    throw new Error("The tunnel network is full");
  }
}

function routerKeys(keys: { publicKey: string; privateKey: string }) {
  return { routerPublicKey: keys.publicKey, routerPrivateKey: keys.privateKey };
}
