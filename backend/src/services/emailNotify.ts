import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  if (!config.email?.smtp?.host) {
    logger.warn('Email SMTP not configured — email notifications disabled');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.secure,
    auth: {
      user: config.email.smtp.user,
      pass: config.email.smtp.pass,
    },
  });

  return transporter;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) return false;

  try {
    await transport.sendMail({
      from: config.email?.from || 'Funding Finder <noreply@fundingfinder.app>',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    logger.info(`Email sent to ${options.to}: ${options.subject}`);
    return true;
  } catch (err) {
    logger.error({ err, to: options.to }, 'Failed to send email');
    return false;
  }
}

export async function sendAlertEmail(
  to: string,
  alertType: 'general' | 'arbitrage',
  data: {
    pair: string;
    exchange?: string;
    exchangeA?: string;
    exchangeB?: string;
    currentRate?: number;
    threshold?: number;
    difference?: number;
    condition?: string;
  }
): Promise<boolean> {
  let subject: string;
  let body: string;

  if (alertType === 'general') {
    const ratePct = data.currentRate !== undefined ? (data.currentRate * 100).toFixed(6) : 'N/A';
    const threshPct = data.threshold !== undefined ? (data.threshold * 100).toFixed(6) : 'N/A';
    const direction = data.condition === 'above' ? 'above' : 'below';

    subject = `Alert: ${data.pair} on ${data.exchange} - Rate ${direction} threshold`;
    body = `
      <h2>Funding Rate Alert</h2>
      <p><strong>Pair:</strong> ${data.pair}</p>
      <p><strong>Exchange:</strong> ${data.exchange}</p>
      <p><strong>Current Rate:</strong> ${ratePct}%/hr</p>
      <p><strong>Threshold:</strong> ${direction} ${threshPct}%/hr</p>
      <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
    `;
  } else {
    const diffPct = data.difference !== undefined ? (data.difference * 100).toFixed(6) : 'N/A';
    const threshPct = data.threshold !== undefined ? (data.threshold * 100).toFixed(6) : 'N/A';

    subject = `Arbitrage Alert: ${data.pair} - ${data.exchangeA} ↔ ${data.exchangeB}`;
    body = `
      <h2>Arbitrage Opportunity</h2>
      <p><strong>Pair:</strong> ${data.pair}</p>
      <p><strong>Exchanges:</strong> ${data.exchangeA} ↔ ${data.exchangeB}</p>
      <p><strong>Difference:</strong> ${diffPct}%/hr</p>
      <p><strong>Threshold:</strong> > ${threshPct}%/hr</p>
      <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
    `;
  }

  return sendEmail({ to, subject, html: body });
}

export async function sendDailySummaryEmail(
  to: string,
  data: {
    topPairs: Array<{
      pair: string;
      exchange: string;
      ratePerHour: number;
      interval: string;
    }>;
    totalScanned: number;
  }
): Promise<boolean> {
  const rows = data.topPairs
    .map(
      (p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${p.exchange.toUpperCase()}:${p.pair}</td>
        <td>${(p.ratePerHour * 100).toFixed(6)}%</td>
        <td>${p.interval}</td>
      </tr>
    `
    )
    .join('');

  const html = `
    <h2>Daily Funding Report</h2>
    <p>Total contracts scanned: <strong>${data.totalScanned}</strong></p>
    <h3>Top 5 by Hourly Rate</h3>
    <table border="1" cellpadding="8" cellspacing="0">
      <thead>
        <tr>
          <th>#</th>
          <th>Pair</th>
          <th>Rate/hr</th>
          <th>Interval</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#666;font-size:12px">Generated at ${new Date().toLocaleString()}</p>
  `;

  return sendEmail({
    to,
    subject: `Daily Funding Report - ${new Date().toLocaleDateString()}`,
    html,
  });
}
