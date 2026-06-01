import { sendEmail } from "./emailService";

function escapeHtml(value?: string | null) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function readableExpiry(value?: string | null) {
  if (!value) return "the expiry shown in your setup link";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toUTCString();
}

export async function sendResidentInviteEmail(input: {
  to: string;
  residentName?: string | null;
  estateName?: string | null;
  homeLabel: string;
  role?: string | null;
  inviteUrl: string;
  qrDataUrl: string;
  expiresAt?: string | null;
}) {
  const residentName = escapeHtml(input.residentName || "Resident");
  const estateName = escapeHtml(input.estateName || "your estate");
  const homeLabel = escapeHtml(input.homeLabel);
  const role = escapeHtml(input.role || "resident");
  const inviteUrl = escapeHtml(input.inviteUrl);
  const expiry = escapeHtml(readableExpiry(input.expiresAt));
  const qrContent = String(input.qrDataUrl || "").split(",")[1] || "";

  return sendEmail({
    to: input.to,
    subject: `Set up your Oyi Home access for ${input.estateName || input.homeLabel}`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:620px;margin:auto;">
        <h1 style="margin:0 0 12px;font-size:26px;">Welcome to Oyi Home</h1>
        <p>Hello ${residentName},</p>
        <p>${estateName} has invited you to activate your secure residential access.</p>
        <div style="margin:20px 0;padding:16px;border-radius:14px;background:#f1f5f9;">
          <div><strong>Home:</strong> ${homeLabel}</div>
          <div><strong>Role:</strong> ${role}</div>
          <div><strong>Expires:</strong> ${expiry}</div>
        </div>
        <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0284c7;color:#fff;text-decoration:none;font-weight:700;">Activate Oyi Home</a></p>
        <p>You can also scan the attached QR code from the Oyi mobile app.</p>
        <p style="font-size:12px;color:#64748b;">This is a private one-time setup link. Do not forward it.</p>
      </div>
    `,
    text: `Hello ${input.residentName || "Resident"}, activate your Oyi Home access for ${input.homeLabel} as ${input.role || "resident"} before ${readableExpiry(input.expiresAt)}: ${input.inviteUrl}`,
    attachments: qrContent ? [{ filename: "oyi-home-invitation-qr.png", content: qrContent }] : undefined,
  });
}

export async function sendResidentWelcomeEmail(input: {
  to: string;
  residentName?: string | null;
  estateName?: string | null;
  homeLabel?: string | null;
}) {
  const residentName = escapeHtml(input.residentName || "Resident");
  const estateName = escapeHtml(input.estateName || "your estate");
  const homeLabel = escapeHtml(input.homeLabel || "your home");
  return sendEmail({
    to: input.to,
    subject: "Your Oyi Home is ready",
    html: `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:620px;margin:auto;">
        <h1 style="margin:0 0 12px;font-size:26px;">Your living intelligence is ready</h1>
        <p>Hello ${residentName},</p>
        <p>Your Oyi access for ${homeLabel} at ${estateName} is active.</p>
        <p>Open Oyi Home to explore your services, security, devices, visitors, community, and Oyi intelligence.</p>
      </div>
    `,
    text: `Hello ${input.residentName || "Resident"}, your Oyi access for ${input.homeLabel || "your home"} at ${input.estateName || "your estate"} is active.`,
  });
}
