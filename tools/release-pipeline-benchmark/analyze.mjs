#!/usr/bin/env node
/**
 * WW-148 Phase A：只读采样 GHA workflow run → job/step 耗时 → p50/p95 基线表。
 *
 * 用法：
 *   node tools/release-pipeline-benchmark/analyze.mjs
 *   node tools/release-pipeline-benchmark/analyze.mjs --profile tools/release-pipeline-benchmark/profiles.phase-a.json
 *   node tools/release-pipeline-benchmark/analyze.mjs --write docs/release-pipeline-baseline-2026-10.md
 *
 * 需要：gh auth login 或 GITHUB_TOKEN（read-only 即可）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { durationSeconds, summarize, roundSec } from './lib/stats.mjs';
import {
  listWorkflowRuns,
  getRunJobs,
  listTags,
  getCommitDate,
  searchCommits,
} from './lib/gh.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    profile: path.join(__dirname, 'profiles.phase-a.json'),
    write: null,
    json: null,
    runs: null,
    verbose: false,
    includeSamples: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') out.profile = argv[++i];
    else if (a === '--write') out.write = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--runs') out.runs = Number(argv[++i]);
    else if (a === '--include-samples') out.includeSamples = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node analyze.mjs [--profile PATH] [--write MD] [--json PATH] [--runs N]`);
      process.exit(0);
    }
  }
  return out;
}

function runWallSeconds(run) {
  return durationSeconds(run.created_at, run.updated_at);
}

function extractRunDetail(repo, run, jobs) {
  const jobRows = [];
  const stepRows = [];
  for (const job of jobs) {
    const jobSec = durationSeconds(job.started_at, job.completed_at);
    jobRows.push({
      job: job.name,
      conclusion: job.conclusion,
      seconds: jobSec,
    });
    for (const step of job.steps ?? []) {
      const stepSec = durationSeconds(step.started_at, step.completed_at);
      if (stepSec == null) continue;
      stepRows.push({
        job: job.name,
        step: step.name,
        conclusion: step.conclusion,
        seconds: stepSec,
      });
    }
  }
  return {
    repo,
    run_id: run.id,
    workflow: run.name,
    workflow_path: run.path,
    event: run.event,
    head_branch: run.head_branch,
    display_title: run.display_title,
    conclusion: run.conclusion,
    html_url: run.html_url,
    created_at: run.created_at,
    updated_at: run.updated_at,
    run_wall_seconds: runWallSeconds(run),
    jobs: jobRows,
    steps: stepRows,
  };
}

function bucketKey(repo, workflowLabel, job, step) {
  return `${repo} | ${workflowLabel} | ${job} :: ${step}`;
}

function aggregateStepStats(samples) {
  /** @type {Map<string, number[]>} */
  const byKey = new Map();
  for (const s of samples) {
    for (const st of s.steps) {
      if (st.conclusion === 'skipped') continue;
      const key = bucketKey(s.repo, s.workflow, st.job, st.step);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(st.seconds);
    }
  }
  const rows = [];
  for (const [key, vals] of byKey) {
    const stat = summarize(vals);
    rows.push({ key, ...stat });
  }
  rows.sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));
  return rows;
}

function aggregateJobStats(samples) {
  const byKey = new Map();
  for (const s of samples) {
    for (const j of s.jobs) {
      if (j.conclusion === 'skipped' || j.seconds == null) continue;
      const key = `${s.repo} | ${s.workflow} | ${j.job}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(j.seconds);
    }
  }
  const rows = [];
  for (const [key, vals] of byKey) {
    rows.push({ key, ...summarize(vals) });
  }
  rows.sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));
  return rows;
}

function aggregateRunStats(samples) {
  const byKey = new Map();
  for (const s of samples) {
    const key = `${s.repo} | ${s.workflow} (${s.event})`;
    if (!byKey.has(key)) byKey.set(key, []);
    if (s.run_wall_seconds != null) byKey.get(key).push(s.run_wall_seconds);
  }
  const rows = [];
  for (const [key, vals] of byKey) {
    rows.push({ key, ...summarize(vals) });
  }
  rows.sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));
  return rows;
}

async function sampleWorkflow(repo, wf, profileSample, verbose) {
  const limit = profileSample.runs_per_workflow ?? 25;
  const allowed = new Set(profileSample.conclusions ?? ['success']);
  const runs = await listWorkflowRuns(repo, wf.file, { limit: limit * 2 });
  const filtered = runs.filter((r) => allowed.has(r.conclusion)).slice(0, limit);
  const details = [];
  for (const run of filtered) {
    const jobs = await getRunJobs(repo, run.id);
    details.push(
      extractRunDetail(repo, { ...run, path: wf.file, name: wf.label || run.name }, jobs),
    );
    if (verbose) process.stderr.write(`. sampled ${repo} ${wf.file} run ${run.id}\n`);
  }
  return { wf, details };
}

async function buildCalendar(profile) {
  const cal = profile.calendar;
  if (!cal) return { rows: [], notes: [] };
  const notes = [];
  const tags = await listTags(cal.bundle_repo, cal.tag_prefix, 8);
  if (!tags.length) {
    notes.push('未找到 actions tag，跳过 calendar 链');
    return { rows: [], notes };
  }
  const rows = [];
  for (const tag of tags) {
    const tagDate = await getCommitDate(cal.bundle_repo, tag);
    for (const consumer of cal.consumer_repos ?? []) {
      let bumpDate = null;
      let bumpSha = null;
      try {
        const commits = await searchCommits(consumer.repo, tag, { since: tagDate, limit: 3 });
        const hit = commits.find((c) => (c.commit?.message || '').includes(tag));
        if (hit) {
          bumpDate = hit.commit?.committer?.date || hit.commit?.author?.date;
          bumpSha = hit.sha;
        }
      } catch (err) {
        notes.push(`${consumer.repo} commit search 失败: ${err.message}`);
      }

      let consumerCiReady = null;
      if (bumpDate) {
        try {
          const runs = await listWorkflowRuns(consumer.repo, 'ci.yml', {
            limit: 30,
            status: 'completed',
            conclusion: 'success',
          });
          const tBump = Date.parse(bumpDate);
          const after = [...runs]
            .filter((r) => Date.parse(r.created_at) >= tBump)
            .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
          if (after) consumerCiReady = after.updated_at;
        } catch {
          /* ignore */
        }
      }

      const tagToBump =
        bumpDate && tagDate ? (Date.parse(bumpDate) - Date.parse(tagDate)) / 1000 : null;
      const tagToCi =
        consumerCiReady && tagDate
          ? (Date.parse(consumerCiReady) - Date.parse(tagDate)) / 1000
          : null;

      rows.push({
        tag,
        tag_at: tagDate,
        consumer: consumer.repo,
        bump_at: bumpDate,
        bump_sha: bumpSha,
        consumer_ci_success_at: consumerCiReady,
        calendar_tag_to_bump_sec: tagToBump,
        calendar_tag_to_consumer_ci_sec: tagToCi,
      });
    }
  }
  return { rows, notes };
}

function mdTable(headers, rows) {
  const sep = headers.map(() => '---');
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function renderMarkdown({ profile, samples, stepStats, jobStats, runStats, calendar, generatedAt }) {
  const lines = [];
  lines.push('# 发布管线基线（Phase A 采样）');
  lines.push('');
  lines.push(`> 生成时间（UTC）：${generatedAt}`);
  lines.push(`> 工具：\`node tools/release-pipeline-benchmark/analyze.mjs\` — 方案见 [release-pipeline-benchmark.md](./release-pipeline-benchmark.md)`);
  lines.push(`> 关联：[WW-148](https://linear.app/drone01/issue/WW-148) / [issue #93](https://github.com/workers-world/worker-actions/issues/93)`);
  lines.push('');
  lines.push('## 采样范围');
  lines.push('');
  for (const r of profile.repos) {
    lines.push(`- **${r.id}** (\`${r.repo}\`)：${r.workflows.map((w) => `\`${w.file}\``).join(', ')}`);
  }
  lines.push(`- 每 workflow 成功 run 上限：**${profile.sample.runs_per_workflow}**（conclusions=${profile.sample.conclusions.join(', ')})`);
  if (profile.calendar?.optional_consumer) {
    lines.push(`- **未采样** \`${profile.calendar.optional_consumer.repo}\`：${profile.calendar.optional_consumer.note}`);
  }
  if (profile.cloudflare_builds?.status === 'gap') {
    lines.push(`- **Cloudflare Builds**：${profile.cloudflare_builds.note}`);
  }
  lines.push('');
  lines.push('## Machine 指标 — workflow run 墙钟（p50 / p95，秒）');
  lines.push('');
  lines.push(
    mdTable(
      ['分组', 'n', 'p50', 'p95', 'min', 'max'],
      runStats.map((r) => [
        r.key,
        String(r.n),
        roundSec(r.p50),
        roundSec(r.p95),
        roundSec(r.min),
        roundSec(r.max),
      ]),
    ),
  );
  lines.push('');
  lines.push('## Machine 指标 — job 墙钟 Top 20（按 p95）');
  lines.push('');
  lines.push(
    mdTable(
      ['job', 'n', 'p50', 'p95'],
      jobStats.slice(0, 20).map((r) => [r.key, String(r.n), roundSec(r.p50), roundSec(r.p95)]),
    ),
  );
  lines.push('');
  lines.push('## Machine 指标 — step 墙钟 Top 30（按 p95）');
  lines.push('');
  lines.push(
    mdTable(
      ['step', 'n', 'p50', 'p95'],
      stepStats.slice(0, 30).map((r) => [r.key, String(r.n), roundSec(r.p50), roundSec(r.p95)]),
    ),
  );
  lines.push('');
  lines.push('## Calendar 指标（与 machine 分开统计）');
  lines.push('');
  lines.push('从 bundle tag 时间点起，到消费者仓出现 bump commit / 首次 CI 成功 run（任意分支，启发式；含人工等待与回填）。');
  lines.push('');
  if (calendar.notes.length) {
    for (const n of calendar.notes) lines.push(`- ${n}`);
    lines.push('');
  }
  if (calendar.rows.length) {
    lines.push(
      mdTable(
        ['tag', 'consumer', 'tag→bump (s)', 'tag→CI绿 (s)', 'bump SHA'],
        calendar.rows.map((r) => [
          r.tag,
          r.consumer.replace('workers-world/', ''),
          roundSec(r.calendar_tag_to_bump_sec),
          roundSec(r.calendar_tag_to_consumer_ci_sec),
          (r.bump_sha || '—').slice(0, 7),
        ]),
      ),
    );
  } else {
    lines.push('_本次采样未得到可链式关联的 calendar 行（例如 planning-release 无近期 run）。_');
  }
  lines.push('');
  lines.push('## ROI 优化清单（Phase B 候选；本 PR 不实施）');
  lines.push('');
  lines.push('| 优先级 | 方向 | 证据 |');
  lines.push('| --- | --- | --- |');
  const roi = buildRoiRows(stepStats, jobStats, runStats, calendar);
  for (const row of roi) {
    lines.push(`| ${row.priority} | ${row.item} | ${row.evidence} |`);
  }
  lines.push('');
  lines.push('## 复跑');
  lines.push('');
  lines.push('```bash');
  lines.push('node tools/release-pipeline-benchmark/analyze.mjs \\');
  lines.push('  --profile tools/release-pipeline-benchmark/profiles.phase-a.json \\');
  lines.push('  --write docs/release-pipeline-baseline-2026-10.md \\');
  lines.push('  --json docs/release-pipeline-baseline-2026-10.json');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function buildRoiRows(stepStats, jobStats, runStats, calendar) {
  /** @type {{ priority: string, item: string, evidence: string }[]} */
  const rows = [];

  const topJob = jobStats[0];
  if (topJob) {
    rows.push({
      priority: 'P1',
      item: `缩短最慢 job 段：\`${topJob.key.split(' | ').pop()}\``,
      evidence: `数据支撑：job p95=${roundSec(topJob.p95)}s（n=${topJob.n}）`,
    });
  }

  const topStep = stepStats.find((s) => !/Post Run|Complete job|Set up job/.test(s.key)) ?? stepStats[0];
  if (topStep) {
    rows.push({
      priority: 'P1',
      item: `缩短热点 step：\`${topStep.key.split(' :: ').pop()}\``,
      evidence: `数据支撑：step p95=${roundSec(topStep.p95)}s（n=${topStep.n}）`,
    });
  }

  const npmCi = stepStats.find((s) => /npm ci/i.test(s.key));
  if (npmCi) {
    rows.push({
      priority: 'P1',
      item: '消费者 verify 路径：npm ci 缓存/并行/条件跳过（无 lock 变更）',
      evidence: `数据支撑：npm ci p50=${roundSec(npmCi.p50)}s p95=${roundSec(npmCi.p95)}s`,
    });
  }

  const zizmor = stepStats.find((s) => /Install zizmor|zizmor/i.test(s.key));
  if (zizmor) {
    rows.push({
      priority: 'P2',
      item: 'workflow-lint：zizmor 安装/基线 checkout 缓存或 pin 到预装 runner 镜像',
      evidence: `数据支撑：相关 step p95=${roundSec(zizmor.p95)}s`,
    });
  }

  const merge = stepStats.find((s) => /Merge release PR/i.test(s.key));
  if (merge) {
    rows.push({
      priority: 'P2',
      item: 'release-auto-merge：调查 merge step 等待（API/branch protection）',
      evidence: `数据支撑：Merge release PR p95=${roundSec(merge.p95)}s`,
    });
  }

  const mok1Run = runStats.find((r) => r.key.includes('mok1') && r.key.includes('pull_request'));
  if (mok1Run && mok1Run.p95 != null) {
    rows.push({
      priority: 'P1',
      item: '消费者 Release PR 整 run 墙钟（含 verify 矩阵与 auto-merge）',
      evidence: `数据支撑：mok1 CI PR p95=${roundSec(mok1Run.p95)}s`,
    });
  }

  const bundle = runStats.find((r) => r.key.includes('Release actions bundle'));
  if (bundle) {
    rows.push({
      priority: 'P3',
      item: 'bundle 打 tag 路径已很短；优化重心应在消费者 verify 与 calendar 等待',
      evidence: `数据支撑：release-actions-bundle p95=${roundSec(bundle.p95)}s`,
    });
  }

  rows.push({
    priority: 'P2',
    item: '空 Release（0 files）短路 / 跳过 ensure-release-pr',
    evidence: '假设待验证：需标注 0-file Release PR 样本量后对比',
  });
  rows.push({
    priority: 'P2',
    item: 'CF Builds 与 GH verify 重复工作合并',
    evidence: '假设待验证：本 Phase 未接入 CF Builds API',
  });
  const calWithBump = (calendar?.rows ?? []).filter((r) => r.calendar_tag_to_bump_sec != null);
  if (calWithBump.length) {
    const maxBump = calWithBump.reduce(
      (a, b) => (a.calendar_tag_to_bump_sec > b.calendar_tag_to_bump_sec ? a : b),
      calWithBump[0],
    );
    rows.push({
      priority: 'P1',
      item: 'Phase B 回填 PR + 消费者 bump 自动化（缩短 calendar）',
      evidence: `数据支撑：${maxBump.tag} tag→bump ${roundSec(maxBump.calendar_tag_to_bump_sec)}s（${maxBump.consumer.replace('workers-world/', '')}）`,
    });
  } else {
    rows.push({
      priority: 'P2',
      item: 'Phase B 回填 PR + 消费者 bump 自动化（缩短 calendar）',
      evidence: '假设待验证：calendar 表无 bump 链样本',
    });
  }

  return rows;
}

async function main() {
  const args = parseArgs(process.argv);
  const profile = JSON.parse(fs.readFileSync(args.profile, 'utf8'));
  if (args.runs) profile.sample.runs_per_workflow = args.runs;

  /** @type {ReturnType<typeof extractRunDetail>[]} */
  const allSamples = [];
  const workflowMeta = [];

  for (const repoCfg of profile.repos) {
    for (const wf of repoCfg.workflows) {
      try {
        const { wf: wfMeta, details } = await sampleWorkflow(
          repoCfg.repo,
          wf,
          profile.sample,
          args.verbose,
        );
        workflowMeta.push({ repo: repoCfg.id, ...wfMeta, sampled: details.length });
        for (const d of details) {
          allSamples.push({ ...d, workflow: wf.label || d.workflow });
        }
      } catch (err) {
        process.stderr.write(`WARN ${repoCfg.repo} ${wf.file}: ${err.message}\n`);
        workflowMeta.push({ repo: repoCfg.id, file: wf.file, error: err.message });
      }
    }
  }

  const stepStats = aggregateStepStats(allSamples);
  const jobStats = aggregateJobStats(allSamples);
  const runStats = aggregateRunStats(allSamples);
  const calendar = await buildCalendar(profile);

  const generatedAt = new Date().toISOString();
  const report = {
    generated_at: generatedAt,
    profile_path: args.profile,
    workflow_meta: workflowMeta,
    sample_count: allSamples.length,
    run_stats: runStats,
    job_stats: jobStats.slice(0, 50),
    step_stats: stepStats.slice(0, 80),
    calendar,
  };
  if (args.includeSamples) report.samples = allSamples;

  const md = renderMarkdown({
    profile,
    samples: allSamples,
    stepStats,
    jobStats,
    runStats,
    calendar,
    generatedAt,
  });

  if (args.json) {
    fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true });
    fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
    process.stderr.write(`Wrote JSON ${args.json}\n`);
  }
  if (args.write) {
    fs.mkdirSync(path.dirname(path.resolve(args.write)), { recursive: true });
    fs.writeFileSync(args.write, md);
    process.stderr.write(`Wrote Markdown ${args.write}\n`);
  } else {
    process.stdout.write(`${md}\n`);
  }

  // 简要 stderr 摘要
  process.stderr.write(
    `Summary: ${allSamples.length} runs, top step p95=${roundSec(stepStats[0]?.p95)}s (${stepStats[0]?.key ?? 'n/a'})\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
