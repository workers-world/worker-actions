#!/usr/bin/env node
/**
 * Self-hosted AI PR review (OpenCode 2.0–style, non-blocking MVP).
 * Security + code-quality experts, light coordinator merge → PR comment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MARKER = '<!-- workers-world-ai-review -->';
const MAX_DIFF_CHARS = 120_000;

function env(name, fallback = '') {
  return (process.env[name] ?? fallback).trim();
}

function maskSecret(value) {
  if (value) console.log(`::add-mask::${value}`);
}

function loadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseExtraHeaders(raw) {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return {};
    }
  }
  const out = {};
  for (const part of trimmed.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

function gitDiff(baseRef, headRef) {
  const cwd = process.env.REVIEW_WORKDIR || process.cwd();
  try {
    execFileSync('git', ['fetch', 'origin', baseRef, headRef], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    /* best-effort fetch */
  }
  let diff = '';
  try {
    diff = execFileSync(
      'git',
      ['diff', '--no-color', `origin/${baseRef}...${headRef}`],
      { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
    );
  } catch (e) {
    throw new Error(`git diff failed: ${e.message}`);
  }
  let truncated = false;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n\n… (diff truncated at ${MAX_DIFF_CHARS} chars)`;
    truncated = true;
  }
  return { diff, truncated };
}

async function chatCompletion({ url, token, model, extraHeaders, messages, temperature }) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...extraHeaders,
  };
  const body = {
    model,
    messages,
    temperature: temperature ?? 0.2,
  };
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - started;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('LLM response is not JSON');
  }
  const choice = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ?? {};
  return {
    content: choice,
    elapsedMs,
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  };
}

function expertSystemPrompt(expertId, expertRules, repoContext) {
  return [
    `You are the "${expertId}" reviewer on a pull request.`,
    'Respond with JSON only (no markdown fences):',
    '{"findings":[{"severity":"high|medium|low","title":"...","detail":"...","file":"optional path","line":optional number}],"summary":"one paragraph"}',
    'Focus on actionable issues; omit nitpicks unless severity is medium+.',
    '',
    'Expert rules:',
    expertRules || '(none)',
    '',
    'Repository context (AGENTS.md / conventions):',
    repoContext || '(none)',
  ].join('\n');
}

function parseExpertJson(raw) {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { findings: [], summary: trimmed.slice(0, 2000), parseError: true };
  }
  try {
    const j = JSON.parse(jsonMatch[0]);
    const findings = Array.isArray(j.findings) ? j.findings : [];
    return {
      findings,
      summary: String(j.summary ?? ''),
      parseError: false,
    };
  } catch {
    return { findings: [], summary: trimmed.slice(0, 2000), parseError: true };
  }
}

async function runExpert(expert, diff, repoContext, llm) {
  const system = expertSystemPrompt(expert.id, expert.rules, repoContext);
  const user = `Review this unified diff:\n\n${diff}`;
  const result = await chatCompletion({
    ...llm,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: expert.temperature ?? 0.2,
  });
  const parsed = parseExpertJson(result.content);
  return { expertId: expert.id, label: expert.label, ...parsed, metrics: result };
}

async function runCoordinator(expertResults, llm) {
  const payload = expertResults.map((e) => ({
    expert: e.label,
    summary: e.summary,
    findings: e.findings,
  }));
  const system = [
    'You coordinate PR review experts. Merge their JSON into one markdown report for a GitHub PR comment.',
    'Structure:',
    '## AI PR Review (workers-world)',
    '### Summary',
    '### Security',
    '### Code quality',
    '### Findings table (severity | area | title | detail)',
    'Be concise; use Chinese if diff/commits suggest Chinese team (default Chinese).',
    'Do not invent findings not present in expert input.',
  ].join('\n');
  const user = `Expert outputs:\n${JSON.stringify(payload, null, 2)}`;
  const result = await chatCompletion({
    ...llm,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
  });
  return { body: result.content.trim(), metrics: result };
}

function appendObservability(body, obs) {
  const lines = [
    '',
    '---',
    '<details><summary>Review observability (MVP)</summary>',
    '',
    '| metric | value |',
    '|---|---|',
    `| duration_ms | ${obs.totalMs} |`,
    `| model | \`${obs.model}\` |`,
    `| diff_truncated | ${obs.diffTruncated} |`,
  ];
  for (const m of obs.expertMetrics) {
    lines.push(
      `| ${m.label} tokens | prompt=${m.promptTokens ?? '?'} completion=${m.completionTokens ?? '?'} (${m.elapsedMs}ms) |`,
    );
  }
  if (obs.coordinatorMetrics) {
    const c = obs.coordinatorMetrics;
    lines.push(
      `| coordinator tokens | prompt=${c.promptTokens ?? '?'} completion=${c.completionTokens ?? '?'} (${c.elapsedMs}ms) |`,
    );
  }
  if (obs.errors.length) {
    lines.push('', '**Errors (non-blocking):**', ...obs.errors.map((e) => `- ${e}`));
  }
  lines.push('', '</details>');
  return `${body}\n${lines.join('\n')}`;
}

function postPrComment(repo, prNumber, body, token) {
  const fullBody = `${MARKER}\n${body}`;
  const ghEnv = { ...process.env, GH_TOKEN: token };
  const listJson = execFileSync(
    'gh',
    ['api', `repos/${repo}/issues/${prNumber}/comments`, '--paginate'],
    { encoding: 'utf8', env: ghEnv },
  );
  const comments = JSON.parse(listJson);
  const existing = comments.find((c) => c.body?.includes(MARKER));
  const tmp = path.join('/tmp', `ai-review-body-${process.pid}.md`);
  fs.writeFileSync(tmp, JSON.stringify({ body: fullBody }), 'utf8');
  try {
    if (existing) {
      execFileSync(
        'gh',
        [
          'api',
          '--method',
          'PATCH',
          `repos/${repo}/issues/comments/${existing.id}`,
          '--input',
          tmp,
        ],
        { stdio: 'inherit', env: ghEnv },
      );
      console.log(`Updated AI review comment ${existing.id}`);
    } else {
      execFileSync(
        'gh',
        ['pr', 'comment', String(prNumber), '--repo', repo, '--body-file', tmp],
        { stdio: 'inherit', env: ghEnv },
      );
      console.log('Created AI review comment');
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function writeStepSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, markdown);
  }
}

async function main() {
  const started = Date.now();
  const repo = env('GITHUB_REPOSITORY');
  const prNumber = env('PR_NUMBER');
  const baseRef = env('BASE_REF', 'master');
  const headRef = env('HEAD_REF');
  const token = env('GH_TOKEN') || env('GITHUB_TOKEN');
  const workdir = env('REVIEW_WORKDIR', process.cwd());

  const url =
    env('AI_REVIEW_LLM_URL') ||
    'https://api.deepseek.com/v1/chat/completions';
  const model = env('AI_REVIEW_LLM_MODEL') || 'deepseek-chat';
  const llmToken = env('AI_REVIEW_LLM_TOKEN');
  maskSecret(llmToken);

  if (!llmToken) {
    console.log('::notice::AI_REVIEW_LLM_TOKEN 未配置，跳过 AI PR review');
    return;
  }
  if (!prNumber || !/^\d+$/.test(prNumber)) {
    throw new Error('PR_NUMBER 须为纯数字');
  }
  if (!headRef) {
    throw new Error('HEAD_REF 必填');
  }

  const configPath = env('AI_REVIEW_CONFIG', '.ai-review/config.json');
  const defaultConfigPath = path.join(workdir, 'docs/ai-review/default-config.json');
  const config = fs.existsSync(path.join(workdir, configPath))
    ? loadJson(path.join(workdir, configPath), {})
    : loadJson(defaultConfigPath, {});

  const language = config.language || env('AI_REVIEW_LANGUAGE', 'Chinese');
  const experts = config.experts?.length
    ? config.experts
    : [
        { id: 'security', label: 'Security', rulesFile: 'docs/ai-review/experts/security.md' },
        { id: 'code-quality', label: 'Code quality', rulesFile: 'docs/ai-review/experts/code-quality.md' },
      ];

  const agentsMd = loadText(path.join(workdir, 'AGENTS.md'));
  const repoContext = [agentsMd, loadText(path.join(workdir, 'docs/ai-review/repo-context.md'))]
    .filter(Boolean)
    .join('\n\n');

  const llm = {
    url,
    token: llmToken,
    model: config.model || model,
    extraHeaders: parseExtraHeaders(env('AI_REVIEW_LLM_EXTRA_HEADERS')),
  };

  const { diff, truncated } = gitDiff(baseRef, headRef);
  if (!diff.trim()) {
    console.log('::notice::Empty diff — skip AI review');
    return;
  }

  const errors = [];
  const expertResults = [];
  const expertMetrics = [];

  for (const spec of experts) {
    const rules =
      spec.rules ||
      loadText(path.join(workdir, spec.rulesFile || `docs/ai-review/experts/${spec.id}.md`));
    try {
      const r = await runExpert(
        {
          id: spec.id,
          label: spec.label || spec.id,
          rules,
          temperature: spec.temperature,
        },
        diff,
        repoContext,
        llm,
      );
      expertResults.push(r);
      expertMetrics.push({ label: r.label, ...r.metrics });
    } catch (e) {
      errors.push(`${spec.id}: ${e.message}`);
      console.log(`::warning::Expert ${spec.id} failed: ${e.message}`);
    }
  }

  let commentBody = '';
  let coordinatorMetrics = null;
  if (expertResults.length === 0) {
    commentBody = `## AI PR Review\n\n所有 expert 调用失败（非阻断）。语言：${language}`;
  } else {
    try {
      const coord = await runCoordinator(expertResults, llm);
      commentBody = coord.body;
      coordinatorMetrics = coord.metrics;
    } catch (e) {
      errors.push(`coordinator: ${e.message}`);
      commentBody = [
        '## AI PR Review',
        '',
        'Coordinator 失败，以下为 expert 原始摘要：',
        ...expertResults.map((e) => `- **${e.label}**: ${e.summary || '(no summary)'}`),
      ].join('\n');
    }
  }

  const totalMs = Date.now() - started;
  commentBody = appendObservability(commentBody, {
    totalMs,
    model: llm.model,
    diffTruncated: truncated,
    expertMetrics,
    coordinatorMetrics,
    errors,
  });

  postPrComment(repo, prNumber, commentBody, token);

  writeStepSummary(
    `## AI PR review\n\n- duration_ms: ${totalMs}\n- model: \`${llm.model}\`\n- experts: ${expertResults.length}\n`,
  );
  console.log(`::notice::AI review completed in ${totalMs}ms`);
}

main().catch((err) => {
  console.log(`::warning::AI PR review failed (non-blocking): ${err.message}`);
  process.exitCode = 0;
});
