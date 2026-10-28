import dns from "node:dns/promises";
import net from "node:net";
import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";

// nodemailer resolves both A and AAAA records for the SMTP host and picks one at
// random to connect to (see nodemailer/lib/shared/index.js formatDNSValue). On
// networks with only a link-local (non-routable) IPv6 interface — common behind
// some routers/VPNs — that causes intermittent EHOSTUNREACH when it picks an
// AAAA address. Resolve to a real IPv4 address ourselves and connect directly to
// it, keeping `tls.servername` so SNI/certificate validation still targets the
// real hostname.
let connectHost = smtpHost;
let servername: string | undefined;
if (!net.isIP(smtpHost)) {
  try {
    const [ipv4] = await dns.resolve4(smtpHost);
    if (ipv4) {
      connectHost = ipv4;
      servername = smtpHost;
    }
  } catch {
    // fall back to hostname-based resolution (nodemailer's default behavior)
  }
}

const transporter = nodemailer.createTransport({
  host: connectHost,
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: process.env.SMTP_PORT === "465",
  ...(servername ? { tls: { servername } } : {}),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function buildFrom(): string {
  const raw = process.env.SMTP_FROM;
  const user = process.env.SMTP_USER ?? "noreply@example.com";
  if (!raw) return `"HashiFi" <${user}>`;
  if (raw.includes("@")) return raw;
  return `"${raw}" <${user}>`;
}

const FROM = buildFrom();
const LOGIN_URL = process.env.FRONTEND_ORIGIN || "http://localhost:4000";

export function smtpReady() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

if (smtpReady()) {
  transporter
    .verify()
    .then(() => {
      console.log("[Mailer] SMTP connection verified — ready to send");
    })
    .catch((err: Error) => {
      console.error("[Mailer] SMTP verification failed:", err.message);
    });
}

// ── Design tokens matching the app ──────────────────────────────────────────
const BRAND_DARK = "#2E2018"; // sidebar dark warm brown
const BRAND_ORANGE = "#D97757"; // primary orange
const BODY_BG = "#F5F3F0"; // warm cream background
const CARD_BG = "#FFFFFF";
const BORDER_COLOR = "#E5DDD6";
const TEXT_MAIN = "#2A1F14";
const TEXT_MUTED = "#7A6A5E";

// ── Layout shell ─────────────────────────────────────────────────────────────
function wrap(accentColor: string, label: string, body: string): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HashiFi</title>
</head>
<body style="margin:0;padding:0;background-color:${BODY_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BODY_BG};padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="background-color:${BRAND_DARK};border-radius:12px 12px 0 0;padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <!-- WiFi icon SVG inline -->
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background-color:${BRAND_ORANGE};border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;">
                      <span style="font-size:18px;line-height:36px;display:block;">📶</span>
                    </td>
                    <td style="padding-left:12px;vertical-align:middle;">
                      <p style="margin:0;color:#FFFFFF;font-size:16px;font-weight:700;letter-spacing:-0.2px;">HashiFi</p>
                      <p style="margin:2px 0 0;color:#8A7A6E;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;">Admin Portal</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Accent bar -->
        <tr><td style="background-color:${accentColor};padding:11px 32px;">
          <p style="margin:0;color:#FFFFFF;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">${label}</p>
        </td></tr>

        <!-- Body card -->
        <tr><td style="background-color:${CARD_BG};padding:32px;border-left:1px solid ${BORDER_COLOR};border-right:1px solid ${BORDER_COLOR};">
          ${body}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background-color:${BODY_BG};border:1px solid ${BORDER_COLOR};border-top:0;border-radius:0 0 12px 12px;padding:18px 32px;">
          <p style="margin:0;color:${TEXT_MUTED};font-size:11px;text-align:center;line-height:1.7;">
            HashiFi &middot; Automated notification — do not reply.<br/>
            Questions? Contact your system administrator.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Content helpers ───────────────────────────────────────────────────────────
function p(text: string) {
  return `<p style="margin:0 0 16px;color:${TEXT_MAIN};font-size:15px;line-height:1.65;">${text}</p>`;
}

function infoBox(lines: { label: string; value: string }[]) {
  const rows = lines
    .map(
      ({ label, value }) =>
        `<tr>
      <td style="padding:11px 16px;border-bottom:1px solid ${BORDER_COLOR};">
        <p style="margin:0;color:${TEXT_MUTED};font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;">${label}</p>
        <p style="margin:3px 0 0;color:${TEXT_MAIN};font-size:14px;font-weight:500;">${value}</p>
      </td>
    </tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background:${BODY_BG};border-radius:8px;border:1px solid ${BORDER_COLOR};margin:20px 0 24px;">
    ${rows}
  </table>`;
}

function alertBox(text: string, bg: string, border: string, color: string) {
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%"
    style="background:${bg};border-radius:8px;border-left:3px solid ${border};margin:20px 0;padding:0;">
    <tr><td style="padding:14px 18px;">
      <p style="margin:0;color:${color};font-size:14px;line-height:1.55;">${text}</p>
    </td></tr>
  </table>`;
}

function cta(text: string, color: string = BRAND_ORANGE) {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
    <tr><td style="background:${color};border-radius:8px;">
      <a href="${LOGIN_URL}" style="display:block;padding:13px 28px;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:0.2px;">${text}</a>
    </td></tr>
  </table>`;
}

function small(text: string) {
  return `<p style="margin:16px 0 0;color:${TEXT_MUTED};font-size:12px;line-height:1.6;">${text}</p>`;
}

// ── Email functions ───────────────────────────────────────────────────────────

export async function sendOtpEmail(to: string, otp: string, name: string) {
  if (!smtpReady()) {
    console.warn(`[Mailer] SMTP not configured. OTP for ${to} is ${otp}`);
    return;
  }

  const body =
    p(`Hello <strong>${name}</strong>,`) +
    p(
      `Use the code below to sign in to your HashiFi admin account. It expires in <strong>10 minutes</strong>.`,
    ) +
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
      <tr><td align="center" style="background:${BODY_BG};border:1px solid ${BORDER_COLOR};border-radius:10px;padding:28px 16px;">
        <p style="margin:0 0 6px;color:${TEXT_MUTED};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">One-Time Code</p>
        <p style="margin:0;font-size:38px;font-weight:700;letter-spacing:10px;color:${TEXT_MAIN};font-family:ui-monospace,monospace;">${otp}</p>
      </td></tr>
    </table>` +
    small(`If you did not request this code, ignore this email — your account remains secure.`);

  await transporter.sendMail({
    from: FROM,
    to,
    subject: `${otp} is your HashiFi login code`,
    html: wrap(BRAND_ORANGE, "Login verification", body),
  });
}

export async function sendWelcomeEmail(to: string, name: string, role: string) {
  if (!smtpReady()) {
    console.warn(`[Mailer] SMTP not configured. Welcome email skipped for ${to}`);
    return;
  }

  const roleLabel = role === "admin" ? "System Administrator" : "Venue Manager";
  const body =
    p(`Hello <strong>${name}</strong>,`) +
    p(
      `Your HashiFi admin account is ready. Sign in with your email address — we'll send you a one-time login code each time.`,
    ) +
    infoBox([
      { label: "Email Address", value: to },
      { label: "Role", value: roleLabel },
    ]) +
    cta("Open Admin Portal") +
    small(`If you weren't expecting this, you can safely ignore it.`);

  await transporter.sendMail({
    from: FROM,
    to,
    subject: "Welcome to HashiFi — Your account is ready",
    html: wrap(BRAND_ORANGE, "Account created", body),
  });
}

export async function sendProfileUpdatedEmail(to: string, name: string) {
  if (!smtpReady()) {
    console.warn(`[Mailer] SMTP not configured. Profile updated email skipped for ${to}`);
    return;
  }

  const body =
    p(`Hello <strong>${name}</strong>,`) +
    p(`Your HashiFi admin account details were recently updated by an administrator.`) +
    alertBox(
      "If you did not expect this change, contact your system administrator immediately.",
      "#EFF6FF",
      "#3B82F6",
      "#1E40AF",
    ) +
    cta("Sign In to Verify Your Account") +
    small(`This is a security notification. No action needed if you were expecting this.`);

  await transporter.sendMail({
    from: FROM,
    to,
    subject: "Your HashiFi account was updated",
    html: wrap("#3B82F6", "Account updated", body),
  });
}

export async function sendAccountSuspendedEmail(to: string, name: string) {
  if (!smtpReady()) {
    console.warn(`[Mailer] SMTP not configured. Suspended email skipped for ${to}`);
    return;
  }

  const body =
    p(`Hello <strong>${name}</strong>,`) +
    p(
      `Your HashiFi admin account has been <strong>suspended</strong>. You won't be able to sign in while suspended.`,
    ) +
    alertBox(
      "Access has been temporarily suspended by an administrator.",
      "#FFFBEB",
      "#F59E0B",
      "#92400E",
    ) +
    small(`If you believe this is a mistake, contact your system administrator.`);

  await transporter.sendMail({
    from: FROM,
    to,
    subject: "Your HashiFi account has been suspended",
    html: wrap("#F59E0B", "Account suspended", body),
  });
}

export async function sendAccountReactivatedEmail(to: string, name: string) {
  if (!smtpReady()) {
    console.warn(`[Mailer] SMTP not configured. Reactivated email skipped for ${to}`);
    return;
  }

  const body =
    p(`Hello <strong>${name}</strong>,`) +
    p(
      `Good news — your HashiFi admin account has been <strong>reactivated</strong>. You can sign in again.`,
    ) +
    cta("Sign In Now", "#10B981") +
    small(`If you have any questions, contact your system administrator.`);

  await transporter.sendMail({
    from: FROM,
    to,
    subject: "Your HashiFi account has been reactivated",
    html: wrap("#10B981", "Account reactivated", body),
  });
}

export async function sendPromotedToAdminEmail(to: string, name: string) {
  if (!smtpReady()) {
    console.warn(`[Mailer] SMTP not configured. Promotion email skipped for ${to}`);
    return;
  }

  const body =
    p(`Hello <strong>${name}</strong>,`) +
    p(
      `You've been promoted to <strong>System Administrator</strong> on HashiFi. Your account now has full access — revenue reports, payment records, team management, and all system settings.`,
    ) +
    alertBox(
      "With admin access comes responsibility. Handle all accounts and data with care.",
      "#F5F3FF",
      "#8B5CF6",
      "#4C1D95",
    ) +
    cta("Open Admin Portal", "#8B5CF6");

  await transporter.sendMail({
    from: FROM,
    to,
    subject: "You've been promoted to Admin on HashiFi",
    html: wrap("#8B5CF6", "Promoted to admin", body),
  });
}

export async function sendDemotedToManagerEmail(
  to: string,
  name: string,
  venueName: string | null,
) {
  if (!smtpReady()) {
    console.warn(`[Mailer] SMTP not configured. Demotion email skipped for ${to}`);
    return;
  }

  const body =
    p(`Hello <strong>${name}</strong>,`) +
    p(
      `Your role on HashiFi has been changed to <strong>Venue Manager</strong>. You no longer have access to revenue reports, payment records, or system-wide settings.`,
    ) +
    (venueName
      ? infoBox([{ label: "Assigned Venue", value: venueName }])
      : alertBox(
          "You haven't been assigned a venue yet. Contact your system administrator.",
          "#FFFBEB",
          "#F59E0B",
          "#92400E",
        )) +
    cta("Open Admin Portal");

  await transporter.sendMail({
    from: FROM,
    to,
    subject: "Your HashiFi role has changed",
    html: wrap(BRAND_ORANGE, "Role updated", body),
  });
}

export async function sendAccountDeletedEmail(to: string, name: string) {
  if (!smtpReady()) {
    console.warn(`[Mailer] SMTP not configured. Deletion email skipped for ${to}`);
    return;
  }

  const body =
    p(`Hello <strong>${name}</strong>,`) +
    p(
      `Your HashiFi admin account has been <strong>permanently removed</strong>. You can no longer sign in to the portal.`,
    ) +
    alertBox("This action is permanent and cannot be undone.", "#FEF2F2", "#EF4444", "#991B1B") +
    small(`If you believe this was done in error, contact your system administrator.`);

  await transporter.sendMail({
    from: FROM,
    to,
    subject: "Your HashiFi account has been removed",
    html: wrap("#EF4444", "Account removed", body),
  });
}
