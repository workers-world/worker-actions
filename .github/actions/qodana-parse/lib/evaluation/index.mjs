/**
 * Qodana SARIF 评判逻辑（Node / CI / Qodana CLI 共用）
 * 与 orchestrator-worker/src/evaluation 中 Qodana 相关语义一致。
 */

export function parseSarifIssue(result) {
    const location = result.locations?.[0]?.physicalLocation ?? {};
    const region = location.region ?? {};
    const file = location.artifactLocation?.uri ?? 'unknown';
    const props = result.properties ?? {};

    return {
        ruleId: result.ruleId ?? 'unknown',
        level: result.level ?? 'unknown',
        file,
        line: region.startLine ?? null,
        column: region.startColumn ?? null,
        message: result.message?.text ?? '',
        qodanaSeverity: props.qodanaSeverity ?? null,
    };
}

export function isBlockingQodanaIssue(issue) {
    return issue.level === 'error' || issue.qodanaSeverity === 'High';
}

export function evaluateQodanaSummary(summary) {
    const violations = [];

    for (const issue of summary.issues) {
        const isBlocking = isBlockingQodanaIssue(issue);
        violations.push({
            ruleId: isBlocking ? 'qodana.blocking' : 'qodana.warning',
            message: `${issue.file}:${issue.line ?? '?'} (${issue.ruleId}) ${issue.message}`,
            severity: isBlocking ? 'hard' : 'soft',
        });
    }

    const hardFails = violations.filter((v) => v.severity === 'hard');
    return {
        pass: hardFails.length === 0,
        score: Math.max(0, 100 - hardFails.length * 15 - violations.length * 5),
        feedback: violations.map((v) => `- [${v.ruleId}] ${v.message}`).join('\n'),
        violations,
    };
}

export function shouldFailQodana(summary) {
    return !evaluateQodanaSummary(summary).pass;
}

export function buildQodanaSummary(reportFile, issues) {
    return { reportFile, total: issues.length, issues };
}
