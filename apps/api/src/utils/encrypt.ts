import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
// No fallback: a default key in a public repository would encrypt router passwords with a
// value anyone can read.
if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is required");
const key = scryptSync(ENCRYPTION_KEY, "hashifi-router-credentials", 32);

export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(encryptedText: string): string {
  const [ivHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
