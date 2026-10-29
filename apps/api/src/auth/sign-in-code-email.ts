import type { EmailMessage } from "../email/email-sender.js";

export const SIGN_IN_CODE_MINUTES = 10;

export function signInCodeEmail(to: string, code: string): EmailMessage {
  return {
    to,
    subject: `${code} is your HashiFi sign-in code`,
    text: [
      `Your HashiFi sign-in code is ${code}.`,
      "",
      `It works once, for ${SIGN_IN_CODE_MINUTES} minutes. If you did not try to sign in, ignore this email: nobody can sign in without the code.`,
    ].join("\n"),
  };
}
