/**
 * Quick manual test for email service.
 * Run with: TEST_EMAIL=you@example.com npx tsx scripts/test-email.ts
 *
 * Delete after verifying Resend works, or keep for debugging.
 */

import { sendEmail } from '../src/services/email.js';

const TEST_EMAIL = process.env.TEST_EMAIL;

if (!TEST_EMAIL) {
  console.error('Error: TEST_EMAIL environment variable is required.');
  console.error('Usage: TEST_EMAIL=you@example.com npx tsx scripts/test-email.ts');
  process.exit(1);
}

async function main() {
  const email = TEST_EMAIL as string; // validated above
  console.log(`Sending test email to ${email}...`);

  const result = await sendEmail({
    to: [email],
    subject: 'Ethogram API - Test Email',
    text: 'If you received this, the email service is working!',
    html: '<p>If you received this, the email service is <strong>working</strong>!</p>',
  });

  if (result.success) {
    console.log('✓ Email sent successfully!');
    console.log(`  Message ID: ${result.messageId}`);
  } else {
    console.error('✗ Email failed:', result.error);
    process.exit(1);
  }
}

main();
