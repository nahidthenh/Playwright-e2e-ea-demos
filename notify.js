#!/usr/bin/env node
'use strict';

/**
 * notify.js
 *
 * Reads reports/results.json (written by compare.js) and posts a summary
 * to Slack via an Incoming Webhook.
 *
 * Required env vars:
 *   SLACK_WEBHOOK_URL  – Slack Incoming Webhook URL
 *
 * Optional env vars (set automatically by the GitHub Actions workflow):
 *   PAGES_URL          – GitHub Pages report URL
 *   RUN_URL            – GitHub Actions run URL
 */

const fs = require('fs');
const path = require('path');
const { IncomingWebhook } = require('@slack/webhook');

const RESULTS_PATH = path.join(__dirname, 'reports', 'results.json');

// ── Validate env ──────────────────────────────────────────────────────────────
const webhookUrl = process.env.SLACK_WEBHOOK_URL;
if (!webhookUrl) {
  console.error('SLACK_WEBHOOK_URL environment variable is not set.');
  process.exit(1);
}

// ── Read results ──────────────────────────────────────────────────────────────
if (!fs.existsSync(RESULTS_PATH)) {
  console.error(`Results file not found: ${RESULTS_PATH}`);
  console.error('Run `node compare.js` before calling notify.js.');
  process.exit(1);
}

const { summary, timestamp } = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
const { total, pass, fail, missing, error: errCount, new: newCount } = summary;

const hasRegressions = fail > 0 || missing > 0 || errCount > 0;
const statusIcon  = hasRegressions ? ':x:' : ':white_check_mark:';
const statusText  = hasRegressions ? 'Visual Regressions Detected' : 'Visual Regression Passed';

const pagesUrl = process.env.PAGES_URL || '';
const runUrl   = process.env.RUN_URL   || '';

// ── Build Block Kit message ───────────────────────────────────────────────────
const blocks = [
  {
    type: 'header',
    text: { type: 'plain_text', text: `${statusIcon.replace(/:/g, '')} ${statusText}` },
  },
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: [
        `*${statusIcon} ${statusText}*`,
        `Ran at <!date^${Math.floor(new Date(timestamp).getTime() / 1000)}^{date_short_pretty} {time}|${timestamp}>`,
      ].join('\n'),
    },
  },
  {
    type: 'section',
    fields: [
      { type: 'mrkdwn', text: `*Total*\n${total}` },
      { type: 'mrkdwn', text: `:white_check_mark: *Pass*\n${pass}` },
      { type: 'mrkdwn', text: `:x: *Fail*\n${fail}` },
      { type: 'mrkdwn', text: `:warning: *Missing*\n${missing}` },
      ...(newCount  ? [{ type: 'mrkdwn', text: `:star: *New*\n${newCount}` }]  : []),
      ...(errCount  ? [{ type: 'mrkdwn', text: `:boom: *Error*\n${errCount}` }] : []),
    ],
  },
];

// Add action buttons only when URLs are available
const buttons = [];
if (pagesUrl) buttons.push({ type: 'button', text: { type: 'plain_text', text: 'View Report' }, url: pagesUrl });
if (runUrl)   buttons.push({ type: 'button', text: { type: 'plain_text', text: 'View Run'    }, url: runUrl   });
if (buttons.length) blocks.push({ type: 'actions', elements: buttons });

// ── Send ──────────────────────────────────────────────────────────────────────
(async () => {
  const webhook = new IncomingWebhook(webhookUrl);
  await webhook.send({ blocks });
  console.log(`Slack notification sent — ${statusText}`);
})().catch(err => {
  console.error('Failed to send Slack notification:', err.message);
  process.exit(1);
});
