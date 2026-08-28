#!/usr/bin/env node
/**
 * 解析 Qodana SARIF 报告，输出汇总与明细（CI / 本地共用）。
 *
 * 用法：
 *   node parse-qodana-report.mjs --file qodana.sarif.json
 *   node parse-qodana-report.mjs --file qodana.sarif.json --json
 *   node parse-qodana-report.mjs --file qodana.sarif.json --github-summary
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    buildQodanaSummary,
    isBlockingQodanaIssue,
    parseSarifIssue,
    shouldFailQodana,
} from './lib/evaluation/index.mjs';

function parseArgs(argv) {
    const options = {
        file: null,
        json: false,
        githubSummary: false,
        skipSummary: false,
        skipReason: '',
        headSha: '',
        rules: [],
        pathPrefix: null,
        top: 20,
        failOnHigh: false,
        noFail: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--json') {
            options.json = true;
            options.failOnHigh = true;
        } else if (arg === '--github-summary') {
            options.githubSummary = true;
        } else if (arg === '--skip-summary') {
            options.skipSummary = true;
        } else if (arg === '--skip-reason') {
            options.skipReason = argv[++i] ?? '';
        } else if (arg === '--head-sha') {
            options.headSha = argv[++i] ?? '';
        } else if (arg === '--no-fail') {
            options.noFail = true;
        } else if (arg === '--file') {
            options.file = argv[++i];
        } else if (arg === '--rule') {
            options.rules.push(argv[++i]);
        } else if (arg === '--path') {
            options.pathPrefix = argv[++i];
        } else if (arg === '--top') {
            options.top = Number(argv[++i]);
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`未知参数: ${arg}`);
        }
    }

    return options;
}

function printHelp() {
    console.log(`用法: node parse-qodana-report.mjs --file <sarif> [选项]

选项:
  --file <path>        指定 SARIF 文件（CI 必填）
  --json               输出 JSON（blocking 时 exit 1，除非 --no-fail）
  --github-summary     输出 PR 评论 Markdown
  --skip-summary       生成「跳过扫描」摘要（无需 --file）
  --skip-reason <text> 跳过原因（配合 --skip-summary）
  --head-sha <sha>     当前 head SHA（写入 qodana-meta）
  --no-fail            不因 blocking exit 1
  --rule <id>          按 ruleId 过滤（可重复）
  --path <prefix>      按文件路径前缀过滤
  --top <n>            明细条数上限（默认 20）
  -h, --help           显示帮助`);
}

function countBy(items, keyFn) {
    const counts = {};
    for (const item of items) {
        const key = keyFn(item);
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}

function sortCounts(counts) {
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function filterIssues(issues, options) {
    return issues.filter((issue) => {
        if (options.rules.length > 0 && !options.rules.includes(issue.ruleId)) {
            return false;
        }
        if (options.pathPrefix && !issue.file.startsWith(options.pathPrefix)) {
            return false;
        }
        return true;
    });
}

function buildSummary(reportFile, issues) {
    const base = buildQodanaSummary(reportFile, issues);
    const blocking = issues.filter(isBlockingQodanaIssue);
    return {
        ...base,
        blockingCount: blocking.length,
        pass: !shouldFailQodana(base),
        byLevel: countBy(issues, (issue) => issue.level),
        byRule: countBy(issues, (issue) => issue.ruleId),
        byFile: countBy(issues, (issue) => issue.file),
        blockingIssues: blocking,
    };
}

function printHumanSummary(summary, top) {
    console.log(`报告文件: ${summary.reportFile}`);
    console.log(`总问题数: ${summary.total}（blocking: ${summary.blockingCount}）`);
    console.log('');

    console.log('按级别:');
    for (const [level, count] of sortCounts(summary.byLevel)) {
        console.log(`  ${level}: ${count}`);
    }
    console.log('');

    console.log('按规则:');
    for (const [ruleId, count] of sortCounts(summary.byRule)) {
        console.log(`  ${ruleId}: ${count}`);
    }
    console.log('');

    console.log('=== Blocking 明细 ===');
    for (const issue of summary.blockingIssues.slice(0, top)) {
        const loc = issue.line != null ? `${issue.file}:${issue.line}` : issue.file;
        console.log(`  ${loc} (${issue.ruleId}) ${issue.message}`);
    }
    if (summary.blockingIssues.length > top) {
        console.log(`  ... 还有 ${summary.blockingIssues.length - top} 条 blocking`);
    }
}

function buildSkipSummary(reason, headSha, cachedMeta = {}) {
    const now = new Date().toISOString();
    const meta = {
        skipped: true,
        last_scan_sha: cachedMeta.last_scan_sha ?? headSha ?? null,
        last_scan_at: cachedMeta.last_scan_at ?? now,
    };
    return {
        skipped: true,
        skipReason: reason,
        reportFile: null,
        total: 0,
        blockingCount: 0,
        pass: true,
        issues: [],
        blockingIssues: [],
        meta,
    };
}

function formatGithubSummary(summary, top) {
    if (summary.skipped) {
        const metaJson = JSON.stringify(summary.meta ?? {});
        const lines = [
            '<!-- qodana-report -->',
            `<!-- qodana-meta: ${metaJson} -->`,
            '## Qodana 扫描结果',
            '',
            '**状态**: ✅ 通过（跳过扫描）',
            `**原因**: ${summary.skipReason ?? '未执行 Docker 扫描'}`,
            '',
            '_未执行 Qodana Docker 扫描；job 仍视为 success，auto-merge 可继续。若上次已有全量扫描，其 blocking 结论仍适用。_',
        ];
        if (summary.meta?.last_scan_at) {
            lines.push('', `_上次扫描: ${summary.meta.last_scan_at}_`);
        }
        return `${lines.join('\n')}\n`;
    }

    const status = summary.pass ? '✅ 通过' : '❌ blocking 未通过';
    const meta = {
        skipped: false,
        last_scan_sha: summary.headSha ?? null,
        last_scan_at: new Date().toISOString(),
    };
    const lines = [
        '<!-- qodana-report -->',
        `<!-- qodana-meta: ${JSON.stringify(meta)} -->`,
        '## Qodana 扫描结果',
        '',
        `**状态**: ${status}`,
        `**总问题**: ${summary.total} | **Blocking**: ${summary.blockingCount}`,
        '',
    ];

    if (summary.blockingIssues.length === 0) {
        lines.push('无 blocking 问题。');
        return `${lines.join('\n')}\n`;
    }

    lines.push('### Blocking issues', '');
    for (const issue of summary.blockingIssues.slice(0, top)) {
        const loc = issue.line != null ? `${issue.file}:${issue.line}` : issue.file;
        const msg = String(issue.message ?? '').replace(/\r?\n/g, ' ').slice(0, 200);
        lines.push(`- \`${loc}\` **${issue.ruleId}**: ${msg}`);
    }
    if (summary.blockingIssues.length > top) {
        lines.push('', `_另有 ${summary.blockingIssues.length - top} 条 blocking 未列出，见 CI artifact。_`);
    }

    return `${lines.join('\n')}\n`;
}

function loadSummary(options) {
    if (!options.file) {
        throw new Error('请使用 --file 指定 SARIF 报告');
    }
    const reportFile = resolve(options.file);
    if (!existsSync(reportFile)) {
        throw new Error(`报告文件不存在: ${reportFile}`);
    }

    const sarif = JSON.parse(readFileSync(reportFile, 'utf8'));
    const results = sarif.runs?.[0]?.results ?? [];
    const issues = filterIssues(results.map(parseSarifIssue), options);
    return buildSummary(reportFile, issues);
}

function maybeExit(summary, options) {
    if (options.noFail) {
        return;
    }
    if (shouldFailQodana(summary) && (options.json ? options.failOnHigh : true)) {
        process.exit(1);
    }
}

function main() {
    const options = parseArgs(process.argv.slice(2));

    if (options.skipSummary) {
        const summary = buildSkipSummary(options.skipReason, options.headSha);
        if (options.githubSummary) {
            process.stdout.write(formatGithubSummary(summary, options.top));
            return;
        }
        if (options.json) {
            console.log(JSON.stringify(summary, null, 2));
            return;
        }
        console.log(`跳过 Qodana 扫描: ${summary.skipReason}`);
        return;
    }

    const summary = loadSummary(options);
    summary.headSha = options.headSha || null;

    if (options.githubSummary) {
        process.stdout.write(formatGithubSummary(summary, options.top));
        return;
    }

    if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        maybeExit(summary, options);
        return;
    }

    printHumanSummary(summary, options.top);
    maybeExit(summary, options);
}

try {
    main();
} catch (error) {
    console.error(`[parse-qodana-report] ${error.message}`);
    process.exit(1);
}
