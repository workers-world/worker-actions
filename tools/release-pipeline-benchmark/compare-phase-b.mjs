#!/usr/bin/env node
/**
 * Phase B：读取 Phase A 基线 JSON + analyze 新样本 JSON，输出对照表与 verdict。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roundSec } from './lib/stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    baseline: path.join(__dirname, '../../docs/release-pipeline-baseline-2026-10.json'),
    after: null,
    targets: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') out.baseline = argv[++i];
    else if (a === '--after') out.after = argv[++i];
    else if (a === '--target') {
      const raw = argv[++i];
      out.targets.push(JSON.parse(raw));
    }
  }
  if (!out.after || !out.targets.length) {
    console.error(
      'Usage: node compare-phase-b.mjs --after NEW.json --target \'{"label":"…","kind":"job|step","baselineKey":"…","afterKey":"…"}\'',
    );
    process.exit(1);
  }
  return out;
}

function findStat(stats, key) {
  return stats.find((s) => s.key === key) ?? null;
}

/** @param {number | null | undefined} baseP95 */
function verdict(baseP95, newP95) {
  if (baseP95 == null || newP95 == null) return '未测';
  const drop = baseP95 - newP95;
  const pct = baseP95 > 0 ? (drop / baseP95) * 100 : 0;
  const pass = drop >= 5 || pct >= 15;
  if (newP95 > baseP95 + 0.5) return '退步';
  if (pass) return '前进';
  if (Math.abs(drop) < 0.5) return '持平';
  return '未达阈';
}

function main() {
  const args = parseArgs(process.argv);
  const base = JSON.parse(fs.readFileSync(args.baseline, 'utf8'));
  const after = JSON.parse(fs.readFileSync(args.after, 'utf8'));
  const allStats = [...(base.job_stats ?? []), ...(base.step_stats ?? [])];
  const afterJobs = after.job_stats ?? [];
  const afterSteps = after.step_stats ?? [];

  const rows = [];
  for (const t of args.targets) {
    const b = findStat(allStats, t.baselineKey);
    const pool = t.kind === 'job' ? afterJobs : afterSteps;
    const a = findStat(pool, t.afterKey);
    const bP50 = b?.p50 ?? null;
    const bP95 = b?.p95 ?? null;
    const aP50 = a?.p50 ?? null;
    const aP95 = a?.p95 ?? null;
    const dP95 = bP95 != null && aP95 != null ? roundSec(bP95 - aP95) : null;
    rows.push({
      label: t.label,
      baseline_n: b?.n ?? 0,
      baseline_p50: bP50,
      baseline_p95: bP95,
      after_n: a?.n ?? 0,
      after_p50: aP50,
      after_p95: aP95,
      delta_p95: dP95,
      verdict: verdict(bP95, aP95),
      threshold_pass:
        bP95 != null && aP95 != null
          ? bP95 - aP95 >= 5 || (bP95 > 0 && (bP95 - aP95) / bP95 >= 0.15)
          : false,
      after_key: t.afterKey,
    });
  }
  console.log(JSON.stringify(rows, null, 2));
}

main();
