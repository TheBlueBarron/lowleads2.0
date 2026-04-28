import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

let sesClient: SESClient | null = null;

function getSesClient(): SESClient {
  if (!sesClient) {
    sesClient = new SESClient({ region: process.env['AWS_REGION'] ?? 'us-west-2' });
  }
  return sesClient;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromEmail: string;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  if (process.env['NODE_ENV'] === 'test') {
    // Never send real emails in test mode — log instead
    return;
  }

  const client = getSesClient();
  await client.send(
    new SendEmailCommand({
      Destination: { ToAddresses: [options.to] },
      Message: {
        Subject: { Data: options.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: options.html, Charset: 'UTF-8' },
          Text: { Data: options.text, Charset: 'UTF-8' },
        },
      },
      Source: options.fromEmail,
    }),
  );
}

export function buildVerificationEmail(opts: {
  recipientEmail: string;
  verificationLink: string;
  fromEmail: string;
}): EmailOptions {
  const { recipientEmail, verificationLink } = opts;
  return {
    to: recipientEmail,
    subject: 'Verify your Lowleads account',
    fromEmail: opts.fromEmail,
    text: `Welcome to Lowleads! Verify your email: ${verificationLink}\n\nLink expires in 24 hours.`,
    html: `
      <h2>Welcome to Lowleads</h2>
      <p>Click the link below to verify your email address:</p>
      <p><a href="${verificationLink}">Verify Email Address</a></p>
      <p>This link expires in 24 hours. If you did not create an account, ignore this email.</p>
    `,
  };
}

export function buildPasswordResetEmail(opts: {
  recipientEmail: string;
  resetLink: string;
  fromEmail: string;
}): EmailOptions {
  const { recipientEmail, resetLink } = opts;
  return {
    to: recipientEmail,
    subject: 'Reset your Lowleads password',
    fromEmail: opts.fromEmail,
    text: `Reset your Lowleads password: ${resetLink}\n\nLink expires in 1 hour. If you did not request a reset, ignore this email.`,
    html: `
      <h2>Password Reset</h2>
      <p>Click the link below to reset your Lowleads password:</p>
      <p><a href="${resetLink}">Reset Password</a></p>
      <p>This link expires in 1 hour. If you did not request a reset, ignore this email.</p>
    `,
  };
}

export function buildNewLeadEmail(opts: {
  recipientEmail: string;
  fromEmail: string;
  appUrl: string;
}): EmailOptions {
  const dashboardUrl = `${opts.appUrl}/dashboard/leads`;
  return {
    to: opts.recipientEmail,
    subject: 'New lead received — Lowleads',
    fromEmail: opts.fromEmail,
    text: `You have received a new lead on Lowleads. Review it now: ${dashboardUrl}`,
    html: `
      <h2>New Lead Received</h2>
      <p>A new lead has been submitted to one of your active listings.</p>
      <p><a href="${dashboardUrl}">Review Lead</a></p>
    `,
  };
}

export function buildLeadResolvedEmail(opts: {
  recipientEmail: string;
  fromEmail: string;
  status: string;
  rewardCents: number;
  appUrl: string;
}): EmailOptions {
  const dashboardUrl = `${opts.appUrl}/dashboard/leads`;
  const dollars = (opts.rewardCents / 100).toFixed(2);
  const isSale = opts.status === 'sale';
  const subject = isSale
    ? `Lead converted — you earned $${dollars}`
    : `Lead update: ${opts.status.replace('_', ' ')}`;
  return {
    to: opts.recipientEmail,
    subject,
    fromEmail: opts.fromEmail,
    text: isSale
      ? `Great news! Your lead converted to a sale. You earned $${dollars}. ${dashboardUrl}`
      : `Your lead was marked as ${opts.status.replace('_', ' ')}. ${dashboardUrl}`,
    html: isSale
      ? `<h2>Lead Converted!</h2><p>Your lead resulted in a sale. You earned <strong>$${dollars}</strong>.</p><p><a href="${dashboardUrl}">View Details</a></p>`
      : `<h2>Lead Update</h2><p>Your lead was marked as <strong>${opts.status.replace('_', ' ')}</strong>.</p><p><a href="${dashboardUrl}">View Details</a></p>`,
  };
}

export function buildLowEscrowEmail(opts: {
  recipientEmail: string;
  fromEmail: string;
  balanceCents: number;
  thresholdCents: number;
  appUrl: string;
}): EmailOptions {
  const balance = (opts.balanceCents / 100).toFixed(2);
  const depositUrl = `${opts.appUrl}/dashboard/billing`;
  return {
    to: opts.recipientEmail,
    subject: 'Low escrow balance — Lowleads',
    fromEmail: opts.fromEmail,
    text: `Your Lowleads escrow balance is low: $${balance}. Deposit funds to keep your listings active: ${depositUrl}`,
    html: `
      <h2>Low Escrow Balance</h2>
      <p>Your escrow balance has dropped to <strong>$${balance}</strong>.</p>
      <p>Deposit funds to ensure your listings remain active and leads keep coming in.</p>
      <p><a href="${depositUrl}">Deposit Funds</a></p>
    `,
  };
}

export function buildNewDeviceAlertEmail(opts: {
  recipientEmail: string;
  ip: string;
  userAgent: string;
  fromEmail: string;
}): EmailOptions {
  const { recipientEmail, ip, userAgent } = opts;
  const timestamp = new Date().toUTCString();
  return {
    to: recipientEmail,
    subject: 'New device login detected — Lowleads',
    fromEmail: opts.fromEmail,
    text: `A new device logged into your Lowleads account.\n\nTime: ${timestamp}\nIP: ${ip}\nDevice: ${userAgent}\n\nIf this was not you, reset your password immediately.`,
    html: `
      <h2>New Device Login Detected</h2>
      <p>A login to your Lowleads account was detected from a new device.</p>
      <table>
        <tr><td><strong>Time</strong></td><td>${timestamp}</td></tr>
        <tr><td><strong>IP Address</strong></td><td>${ip}</td></tr>
        <tr><td><strong>Device</strong></td><td>${userAgent}</td></tr>
      </table>
      <p>If this was not you, <strong>reset your password immediately</strong>.</p>
    `,
  };
}
