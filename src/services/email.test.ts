import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to define mock before module hoisting
const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn() };
});

vi.mock('resend', () => {
  return {
    Resend: class {
      emails = {
        send: mockSend,
      };
    },
  };
});

import { sendEmail, sendObservationEmail } from './email.js';

describe('Email Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      mockSend.mockResolvedValueOnce({
        data: { id: 'msg-123' },
        error: null,
      });

      const result = await sendEmail({
        to: ['test@example.com'],
        subject: 'Test Subject',
        text: 'Test body',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['test@example.com'],
          subject: 'Test Subject',
          text: 'Test body',
        })
      );
    });

    it('should handle Resend API errors', async () => {
      mockSend.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invalid API key' },
      });

      const result = await sendEmail({
        to: ['test@example.com'],
        subject: 'Test',
        text: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('should handle network/unexpected errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await sendEmail({
        to: ['test@example.com'],
        subject: 'Test',
        text: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
    });

    it('should include attachments when provided', async () => {
      mockSend.mockResolvedValueOnce({
        data: { id: 'msg-456' },
        error: null,
      });

      const buffer = Buffer.from('test content');
      await sendEmail({
        to: ['test@example.com'],
        subject: 'Test',
        text: 'Test',
        attachments: [{ filename: 'test.xlsx', content: buffer }],
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [{ filename: 'test.xlsx', content: buffer }],
        })
      );
    });

    it('should send to multiple recipients', async () => {
      mockSend.mockResolvedValueOnce({
        data: { id: 'msg-789' },
        error: null,
      });

      await sendEmail({
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Test',
        text: 'Test',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['user1@example.com', 'user2@example.com'],
        })
      );
    });
  });

  describe('sendObservationEmail', () => {
    const excelBuffer = Buffer.from('fake excel content');

    it('should format email with observation details', async () => {
      mockSend.mockResolvedValueOnce({
        data: { id: 'msg-obs-1' },
        error: null,
      });

      const result = await sendObservationEmail({
        to: ['research@example.com'],
        observerName: 'Jane Doe',
        date: '2025-11-29',
        patient: 'Sayyida',
        excelBuffer,
      });

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['research@example.com'],
          subject: 'Ethogram Observation: Sayyida - 2025-11-29',
          attachments: [
            {
              filename: 'ethogram-Sayyida-2025-11-29.xlsx',
              content: excelBuffer,
            },
          ],
        })
      );

      // Check text content includes key info
      const callArgs = mockSend.mock.calls[0]?.[0] as { text: string; html: string };
      expect(callArgs.text).toContain('Jane Doe');
      expect(callArgs.text).toContain('Sayyida');
      expect(callArgs.text).toContain('2025-11-29');
    });

    it('should include HTML version', async () => {
      mockSend.mockResolvedValueOnce({
        data: { id: 'msg-obs-2' },
        error: null,
      });

      await sendObservationEmail({
        to: ['research@example.com'],
        observerName: 'Jane Doe',
        date: '2025-11-29',
        patient: 'Sayyida',
        excelBuffer,
      });

      const callArgs = mockSend.mock.calls[0]?.[0] as { text: string; html: string };
      expect(callArgs.html).toContain('<h2>New Ethogram Observation</h2>');
      expect(callArgs.html).toContain('Jane Doe');
    });

    it('should sanitize special characters in user input', async () => {
      mockSend.mockResolvedValueOnce({
        data: { id: 'msg-safe' },
        error: null,
      });

      await sendObservationEmail({
        to: ['test@example.com'],
        observerName: '<script>alert("xss")</script>',
        date: '2025-11-29',
        patient: 'Test/Patient\nInjection',
        excelBuffer,
      });

      const callArgs = mockSend.mock.calls[0]?.[0] as {
        subject: string;
        html: string;
        attachments: { filename: string }[];
      };
      const filename = callArgs.attachments[0]?.filename;

      // HTML should escape script tags
      expect(callArgs.html).not.toContain('<script>');
      expect(callArgs.html).toContain('&lt;script&gt;');

      // Subject should not contain newlines (header injection)
      expect(callArgs.subject).not.toContain('\n');

      // Filename should sanitize special characters
      expect(filename).not.toContain('/');
      expect(filename).not.toContain('\n');
      expect(filename).toBe('ethogram-Test_Patient_Injection-2025-11-29.xlsx');
    });
  });
});
