// src/services/emailService.ts
import { sendWithResend } from "./mailer/resendMailer";

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  attachments?: Array<{ filename: string; content: string }>;
};

export async function sendEmail(args: SendEmailArgs) {
  return sendWithResend(args);
}
