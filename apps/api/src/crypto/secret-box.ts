import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts secrets at rest (router API passwords, tunnel private keys) with AES-256-GCM: the
 * authentication tag means a tampered or truncated value fails to decrypt instead of producing
 * garbage. Format: `v1:<iv>:<tag>:<ciphertext>`, base64url, so the scheme can change later.
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("SecretBox needs a 32-byte key");
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv, tag, ciphertext]
      .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
      .join(":");
  }

  open(sealed: string): string {
    const [version, iv, tag, ciphertext] = sealed.split(":");
    if (version !== "v1" || !iv || !tag || ciphertext === undefined) {
      throw new Error("Not a sealed secret");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
