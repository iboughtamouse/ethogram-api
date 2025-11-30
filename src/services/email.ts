/**
 * Email Service
 *
 * Sends emails with Excel attachments using Resend.
 */

import { Resend } from 'resend';
import { config } from '../config.js';

const resend = new Resend(config.resendApiKey);

// --- Sanitization helpers ---

/** Escape HTML entities to prevent XSS in email content */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m] ?? m);
}

/** Remove characters unsafe for filenames */
function sanitizeFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9-_]/g, '_');
}

/** Remove newlines to prevent email header injection */
function sanitizeSubject(str: string): string {
  return str.replace(/[\r\n]/g, '');
}

// --- Interfaces ---

interface EmailAttachment {
  filename: string;
  content: Buffer;
}

interface SendEmailOptions {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email with optional attachments.
 *
 * @param options - Email options (to, subject, text, html, attachments)
 * @returns Result with success status and messageId or error
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  try {
    const { data, error } = await resend.emails.send({
      from: config.emailFrom,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments?.map((att) => ({
        filename: att.filename,
        content: att.content,
      })),
    });

    if (error) {
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      success: false,
      error: message,
    };
  }
}

interface ObservationEmailOptions {
  to: string[];
  observerName: string;
  date: string;
  patient: string;
  excelBuffer: Buffer;
}

/**
 * Send an observation email with Excel attachment.
 *
 * @param options - Observation-specific email options
 * @returns Result with success status
 */
export async function sendObservationEmail(
  options: ObservationEmailOptions
): Promise<SendEmailResult> {
  const { to, observerName, date, patient, excelBuffer } = options;

  // Sanitize user input for different contexts
  const filename = `ethogram-${sanitizeFilename(patient)}-${sanitizeFilename(date)}.xlsx`;
  const subject = sanitizeSubject(`Ethogram Observation: ${patient} - ${date}`);

  const text = `
New ethogram observation submitted.

Observer: ${observerName}
Patient: ${patient}
Date: ${date}

The Excel spreadsheet is attached.
`.trim();

  const html = `
<h2>New Ethogram Observation</h2>
<p><strong>Observer:</strong> ${escapeHtml(observerName)}</p>
<p><strong>Patient:</strong> ${escapeHtml(patient)}</p>
<p><strong>Date:</strong> ${escapeHtml(date)}</p>
<p>The Excel spreadsheet is attached.</p>
`.trim();

  return sendEmail({
    to,
    subject,
    text,
    html,
    attachments: [{ filename, content: excelBuffer }],
  });
}
