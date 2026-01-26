// src/services/emailService.ts
import { sendWithResend } from "./mailer/resendMailer";

export type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
};

export async function sendEmail(args: SendEmailArgs) {
  return sendWithResend(args);
}
