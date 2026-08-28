#!/usr/bin/env node
/**
 * 构建 Release PR 阻断邮件的 subject / body / html（供 GHA 写入 GITHUB_OUTPUT）。
 * 环境变量：REPO, PR_NUMBER, HEAD_REF, PR_URL, VERIFY, QODANA, OCR, MERGE, RUN_URL, ANNOTATIONS, REASONS
 * REASONS：用 \n 分隔的原因列表（已由 workflow 算好）。
 */
import { appendFileSync } from 'node:fs';

function env(name) {
  return (process.env[name] ?? '').trim();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 转义行首 ::，防 GHA workflow command 注入 */
function sanitizeAnnotations(raw) {
  if (!raw) {
    return '(无 annotations 或未拉取到)';
  }
  return raw
    .split('\n')
    .map((line) => (line.startsWith('::') ? ` ${line}` : line))
    .join('\n');
}

const repo = env('REPO');
const prNumber = env('PR_NUMBER');
const headRef = env('HEAD_REF');
const prUrl = env('PR_URL');
const verify = env('VERIFY');
const qodana = env('QODANA');
const ocr = env('OCR');
const merge = env('MERGE');
const runUrl = env('RUN_URL');
const reasons = (process.env.REASONS ?? '')
  .split('\n')
  .map((r) => r.trim())
  .filter(Boolean);
const annotations = sanitizeAnnotations(process.env.ANNOTATIONS ?? '');

const subject = `[Release PR] ${repo} #${prNumber} 需人工处理`;

const bodyLines = [
  'Release PR 未能自动合入 master，需要人工介入。',
  '',
  `Repo: ${repo}`,
  `PR: #${prNumber} (${headRef} → master)`,
  `URL: ${prUrl}`,
  `Actions: ${runUrl}`,
  '',
  `Results: verify=${verify} qodana=${qodana} ocr=${ocr} merge=${merge}`,
  '',
  '原因：',
  ...reasons.map((r) => `- ${r}`),
  '',
  'Actions 产物 / Annotations：',
  '----------------------------------------',
  annotations,
  '----------------------------------------',
  '',
  `修复后 push 到 ${headRef} 会更新本 PR 并重跑门禁。`,
];
const body = bodyLines.join('\n');

const reasonHtml = reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('\n');
const html = [
  '<div style="font-family:system-ui,sans-serif;line-height:1.5">',
  '<p>Release PR 未能自动合入 master，需要人工介入。</p>',
  '<ul>',
  `<li><strong>Repo:</strong> ${escapeHtml(repo)}</li>`,
  `<li><strong>PR:</strong> <a href="${escapeHtml(prUrl)}">#${escapeHtml(prNumber)} (${escapeHtml(headRef)} → master)</a></li>`,
  `<li><strong>Actions:</strong> <a href="${escapeHtml(runUrl)}">查看 workflow run</a></li>`,
  `<li><strong>Results:</strong> verify=${escapeHtml(verify)} qodana=${escapeHtml(qodana)} ocr=${escapeHtml(ocr)} merge=${escapeHtml(merge)}</li>`,
  '</ul>',
  '<p><strong>原因：</strong></p>',
  `<ul>\n${reasonHtml}\n</ul>`,
  '<p><strong>Actions 产物 / Annotations：</strong></p>',
  `<pre style="font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;background:#f6f8fa;padding:8px;border-radius:4px">${escapeHtml(annotations)}</pre>`,
  `<p>修复后 push 到 <code>${escapeHtml(headRef)}</code> 会更新本 PR 并重跑门禁。</p>`,
  '</div>',
].join('\n');

function writeOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) {
    process.stdout.write(`${name}=${value}\n`);
    return;
  }
  // multiline delimiter
  appendFileSync(out, `${name}<<EOF\n${value}\nEOF\n`);
}

writeOutput('subject', subject);
writeOutput('body', body);
writeOutput('html', html);
