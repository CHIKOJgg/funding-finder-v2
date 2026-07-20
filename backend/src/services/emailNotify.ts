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

// ---- Growth email automation (waitlist → newsletter) ----

const APP_URL = process.env.AI_APP_URL || 'https://funding-finder-frontend.onrender.com';

function langGreeting(lang?: string | null): { hi: string; sub: string; cta: string; footer: string } {
  switch (lang) {
    case 'ru':
      return {
        hi: 'Спасибо, что с нами!',
        sub: 'Funding Finder собирает ставки фандинга с 23 бирж и показывает лучший рыночно-нейтральный арбитраж за секунды. Никаких крипто-инвестиций от вашего лица — только данные и идеи.',
        cta: 'Открыть бесплатно',
        footer: 'Отписаться можно в одно касание — просто ответьте на это письмо.',
      };
    default:
      return {
        hi: "You're on the list — welcome!",
        sub: 'Funding Finder aggregates funding rates from 23 exchanges and surfaces the best market-neutral arbitrage in seconds. No capital at risk from us — just data and ideas to trade your own edge.',
        cta: 'Open free',
        footer: 'Reply to this email anytime to unsubscribe.',
      };
  }
}

export async function sendWaitlistWelcome(to: string, lang?: string | null): Promise<boolean> {
  const g = langGreeting(lang);
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <h1 style="font-size:22px;margin:0 0 12px">Funding Finder</h1>
      <p style="font-size:16px;font-weight:600;margin:0 0 12px">${g.hi}</p>
      <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 20px">${g.sub}</p>
      <a href="${APP_URL}/?utm_source=waitlist&utm_medium=email&utm_campaign=welcome"
         style="display:inline-block;background:#3390ec;color:#fff;font-weight:600;padding:12px 22px;border-radius:10px;text-decoration:none">
        ${g.cta} →
      </a>
      <p style="font-size:12px;color:#94a3b8;margin:24px 0 0">${g.footer}</p>
    </div>
  `;
  return sendEmail({ to, subject: 'Welcome to Funding Finder', html, text: `${g.hi}\n${g.sub}\n${APP_URL}` });
}

export async function sendWeeklyReportEmail(
  to: string,
  report: {
    windowDays: number;
    bestPair: { pair: string; annualizedPct: number } | null;
    diversifiedAnnualizedPct: number | null;
    pairsAnalyzed: number;
    topLive: Array<{ pair: string; exchangeA: string; exchangeB: string; annualReturn: number | null }>;
  },
  lang?: string | null
): Promise<boolean> {
  const fmtApr = (v: number | null) => (v == null || isNaN(v) ? '—' : `${(v * 100).toFixed(0)}%`);
  const title = lang === 'ru' ? 'Еженедельный отчёт по фандингу' : 'Weekly Funding Report';
  const rows = (report.topLive || [])
    .map(
      (o, i) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${i + 1}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${o.pair}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${o.exchangeA} ↔ ${o.exchangeB}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-weight:600">до ${fmtApr(o.annualReturn)}/год</td>
      </tr>`
    )
    .join('');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <h1 style="font-size:20px;margin:0 0 4px">📊 ${title}</h1>
      <p style="font-size:13px;color:#64748b;margin:0 0 16px">${report.windowDays}-day market-neutral funding recap</p>
      ${report.bestPair ? `<p style="font-size:15px;margin:0 0 6px">🏆 <b>${report.bestPair.pair}</b> — до ${fmtApr(report.bestPair.annualizedPct)}/год</p>` : ''}
      ${report.diversifiedAnnualizedPct != null ? `<p style="font-size:15px;margin:0 0 16px">🧺 ${lang === 'ru' ? 'Диверсиф. портфель' : 'Diversified basket'}: ~${fmtApr(report.diversifiedAnnualizedPct)}/год</p>` : ''}
      ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="text-align:left;color:#64748b"><th>#</th><th>Pair</th><th>Exchanges</th><th>APR</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
      <a href="${APP_URL}/?utm_source=weekly&utm_medium=email&utm_campaign=report"
         style="display:inline-block;margin-top:20px;background:#3390ec;color:#fff;font-weight:600;padding:12px 22px;border-radius:10px;text-decoration:none">
        ${lang === 'ru' ? 'Открыть Funding Finder' : 'Open Funding Finder'} →
      </a>
      <p style="font-size:12px;color:#94a3b8;margin:24px 0 0">${lang === 'ru' ? 'Иллюстративно, не инвест-рекомендация.' : 'Illustrative, not investment advice.'}</p>
    </div>
  `;
  return sendEmail({ to, subject: `📊 ${title}`, html });
}
