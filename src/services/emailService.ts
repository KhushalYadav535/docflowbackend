// Email Notification Service
import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

let transporter: nodemailer.Transporter | null = null;

// Initialize email transporter
export function initializeEmailService() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || '587');
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpFrom = process.env.SMTP_FROM || 'noreply@docflow.com';

  if (!smtpHost || !smtpUser || !smtpPassword) {
    logger.warn('Email service not configured. Email notifications will be disabled.');
    return;
  }

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  });

  logger.info('Email service initialized', { host: smtpHost, port: smtpPort });
}

// Send email notification
export async function sendEmailNotification(
  to: string,
  subject: string,
  html: string,
  text?: string
): Promise<boolean> {
  if (!transporter) {
    logger.warn('Email service not initialized. Skipping email notification.', { to, subject });
    return false;
  }

  try {
    const smtpFrom = process.env.SMTP_FROM || 'noreply@docflow.com';
    
    await transporter.sendMail({
      from: smtpFrom,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });

    logger.info('Email notification sent', { to, subject });
    return true;
  } catch (error: any) {
    logger.error('Failed to send email notification', { error: error.message, to, subject });
    return false;
  }
}

// Email templates
export const emailTemplates = {
  documentUploaded: (userName: string, documentName: string, documentUrl: string) => ({
    subject: `New Document Uploaded: ${documentName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Document Uploaded</h2>
        <p>Hello ${userName},</p>
        <p>A new document has been uploaded to the system:</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Document:</strong> ${documentName}</p>
        </div>
        <p>
          <a href="${documentUrl}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Document
          </a>
        </p>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          This is an automated notification from Document Management System.
        </p>
      </div>
    `,
  }),

  documentApproved: (userName: string, documentName: string, documentUrl: string) => ({
    subject: `Document Approved: ${documentName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #28a745;">Document Approved</h2>
        <p>Hello ${userName},</p>
        <p>Your document has been approved:</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Document:</strong> ${documentName}</p>
        </div>
        <p>
          <a href="${documentUrl}" style="background: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Document
          </a>
        </p>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          This is an automated notification from Document Management System.
        </p>
      </div>
    `,
  }),

  documentRejected: (userName: string, documentName: string, comment: string, documentUrl: string) => ({
    subject: `Document Rejected: ${documentName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">Document Rejected</h2>
        <p>Hello ${userName},</p>
        <p>Your document has been rejected:</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Document:</strong> ${documentName}</p>
          <p style="margin: 10px 0 0 0;"><strong>Reason:</strong> ${comment}</p>
        </div>
        <p>
          <a href="${documentUrl}" style="background: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Document
          </a>
        </p>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          This is an automated notification from Document Management System.
        </p>
      </div>
    `,
  }),

  documentUpdated: (userName: string, documentName: string, documentUrl: string) => ({
    subject: `Document Updated: ${documentName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Document Updated</h2>
        <p>Hello ${userName},</p>
        <p>A document has been updated:</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Document:</strong> ${documentName}</p>
        </div>
        <p>
          <a href="${documentUrl}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Document
          </a>
        </p>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          This is an automated notification from Document Management System.
        </p>
      </div>
    `,
  }),
};
