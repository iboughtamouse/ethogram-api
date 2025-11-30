/**
 * Quick manual test for email service.
 * Run with: npx tsx scripts/test-email.ts
 *
 * Delete after verifying Resend works, or keep for debugging.
 */

import { sendEmail } from '../src/services/email.js';

const TEST_EMAIL = 'iboughtamouse+ethogram@gmail.com';

async function main() {
  console.log(`Sending test email to ${TEST_EMAIL}...`);

  const result = await sendEmail({
    to: [TEST_EMAIL],
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
