#!/usr/bin/env node
/**
 * 判定本次 PR 是否应执行 Qodana Docker 扫描（路径过滤 + 限频）。
 * stdout: JSON { shouldScan, skipReason, lastScanSha?, lastScanAt? }
 */

import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_PATTERNS = [
    /^src\//,
    /^test\//,
    /^tests\//,
    /^migrations\//,
    /^public\//,
    /\.(ts|tsx|js|jsx|mjs|cjs)$/,
    /^qodana\.yaml$/,
    /^package\.json$/,
    /^wrangler\.toml$/,
    /^tsconfig[^/]*\.json$/,
];

function isOrgQodanaEnabled(value) {
    if (value == null || String(value).trim() === '') {
        return false;
    }
    return /^(true|1|yes)$/i.test(String(value).trim());
}

function parseArgs(argv) {
    const options = {
        baseRef: 'master',
        headSha: '',
        throttleMinutes: 30,
        customPaths: '',
        prAction: '',
        cachePath: '',
        orgEnabled: '',
        changedFiles: [],
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--base-ref') options.baseRef = argv[++i];
        else if (arg === '--head-sha') options.headSha = argv[++i];
        else if (arg === '--throttle-minutes') options.throttleMinutes = Number(argv[++i]);
        else if (arg === '--custom-paths') options.customPaths = argv[++i] ?? '';
        else if (arg === '--pr-action') options.prAction = argv[++i];
        else if (arg === '--cache-path') options.cachePath = argv[++i];
        else if (arg === '--org-enabled') options.orgEnabled = argv[++i] ?? '';
        else if (arg === '--changed-file') options.changedFiles.push(argv[++i]);
        else if (arg === '--help' || arg === '-h') {
            console.log('Usage: gate.mjs --changed-file <path> [...] [options]');
            process.exit(0);
        }
    }
    return options;
}

function globToRegExp(pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '§§')
        .replace(/\*/g, '[^/]*')
        .replace(/§§/g, '.*');
    return new RegExp(`^${escaped}$`);
}

function buildMatchers(customPaths) {
    if (!customPaths.trim()) {
        return DEFAULT_PATTERNS;
    }
    return customPaths
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(globToRegExp);
}

function matchesCodePath(file, matchers) {
    return matchers.some((re) => re.test(file));
}

function readCacheState(cachePath) {
    if (!cachePath || !existsSync(cachePath)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(cachePath, 'utf8'));
    } catch {
        return null;
    }
}

function evaluate(options) {
    const cached = readCacheState(options.cachePath);

    if (!isOrgQodanaEnabled(options.orgEnabled)) {
        return {
            shouldScan: false,
            skipReason:
                'Org Variable WORKERS_WORLD_QODANA_ENABLED 未设置或非 true/1/yes（全组织关闭 Qodana 扫描）',
            lastScanSha: cached?.last_scan_sha ?? null,
            lastScanAt: cached?.last_scan_at ?? null,
        };
    }

    const matchers = buildMatchers(options.customPaths);
    const changed = options.changedFiles.filter(Boolean);
    const codeFiles = changed.filter((f) => matchesCodePath(f, matchers));
    const onlyLock =
        changed.length > 0 && changed.every((f) => f === 'package-lock.json');

    if (changed.length === 0 || codeFiles.length === 0 || onlyLock) {
        return {
            shouldScan: false,
            skipReason:
                changed.length === 0
                    ? 'PR 无文件变更'
                    : onlyLock
                      ? '仅 package-lock.json 变更'
                      : '无业务代码路径变更（docs/CI/配置除外）',
            lastScanSha: cached?.last_scan_sha ?? null,
            lastScanAt: cached?.last_scan_at ?? null,
        };
    }

    if (
        options.prAction === 'ready_for_review' ||
        options.prAction === 'opened' ||
        options.prAction === 'reopened'
    ) {
        return { shouldScan: true, skipReason: null };
    }

    if (options.throttleMinutes > 0 && cached?.last_scan_at) {
        const elapsedMs = Date.now() - Date.parse(cached.last_scan_at);
        if (Number.isFinite(elapsedMs) && elapsedMs < options.throttleMinutes * 60_000) {
            return {
                shouldScan: false,
                skipReason: `限频：距上次扫描不足 ${options.throttleMinutes} 分钟（复用上次结论）`,
                lastScanSha: cached.last_scan_sha ?? null,
                lastScanAt: cached.last_scan_at,
            };
        }
    }

    return { shouldScan: true, skipReason: null };
}

try {
    const options = parseArgs(process.argv.slice(2));
    const result = evaluate(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
    console.error(`[qodana-scan-gate] ${error.message}`);
    process.exit(1);
}
