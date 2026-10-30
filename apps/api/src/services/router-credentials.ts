import type { SecretBox } from "../crypto/secret-box.js";
import type { Router } from "../generated/prisma/client.js";
import type { RouterCredentials } from "./mikrotik.js";

/**
 * How this API reaches a router: its management target and decrypted API credentials.
 *
 * The target is the router's tunnel address when it has one (ADR-0006), otherwise its LAN
 * address, which only works when the API shares the router's LAN.
 */
export class RouterAccess {
  constructor(
    private readonly box: SecretBox,
    readonly apiPort: number,
    readonly connectTimeoutSeconds: number,
  ) {}

  managementTarget(router: Router): { host: string; port: number } {
    return { host: router.tunnelAddress ?? router.ipAddress, port: this.apiPort };
  }

  /** Credentials for the router, or null when it has none usable. */
  credentials(router: Router): RouterCredentials | null {
    if (!router.apiUsername || !router.apiPasswordEncrypted) return null;
    try {
      return {
        ...this.managementTarget(router),
        username: router.apiUsername,
        password: this.box.open(router.apiPasswordEncrypted),
        timeoutSeconds: this.connectTimeoutSeconds,
      };
    } catch {
      return null;
    }
  }

  /** Seals a password for storage. */
  sealPassword(password: string): string {
    return this.box.seal(password);
  }
}
