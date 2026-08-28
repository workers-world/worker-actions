// OCR 规则 eval harness（借鉴 Flue vitest-evals）
//
// 目的：对 `.opencodereview/rule.json` / 文档模板做回归，避免规则改动无测试。
// 当前为轻量 Node 脚本（零 LLM）；后续可接 vitest + 固定 fixture PR diff。
//
// 用法：
//   node tools/ocr-eval/run.mjs
//   node tools/ocr-eval/run.mjs --rule docs/templates/opencodereview-rule.base.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const args = process.argv.slice(2);
const ruleIdx = args.indexOf("--rule");
const rulePath =
	ruleIdx >= 0 && args[ruleIdx + 1]
		? path.resolve(root, args[ruleIdx + 1])
		: path.join(root, ".opencodereview/rule.json");

function fail(msg) {
	console.error(`FAIL: ${msg}`);
	process.exitCode = 1;
}

function ok(msg) {
	console.log(`ok: ${msg}`);
}

if (!fs.existsSync(rulePath)) {
	fail(`规则文件不存在: ${rulePath}`);
} else {
	let json;
	try {
		json = JSON.parse(fs.readFileSync(rulePath, "utf8"));
		ok(`JSON 可解析 (${path.relative(root, rulePath)})`);
	} catch (e) {
		fail(`JSON 解析失败: ${e.message}`);
		json = null;
	}
	if (json) {
		if (!json.rules && !json.system_prompt && !Array.isArray(json)) {
			fail("期望含 rules / system_prompt，或为 rule 数组");
		} else {
			ok("结构基本字段存在");
		}
		const text = JSON.stringify(json);
		if (/ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}/.test(text)) {
			fail("规则文件疑似含真实 token 前缀");
		} else {
			ok("无可疑 token 前缀");
		}
	}
}

const doc = path.join(root, "docs/open-code-review.md");
if (fs.existsSync(doc)) {
	const body = fs.readFileSync(doc, "utf8");
	if (!body.includes("enable_session_cache") || !body.includes("--resume")) {
		fail("open-code-review.md 应文档化 session cache / --resume（增量审查）");
	} else {
		ok("文档含增量审查说明");
	}
	if (!body.includes("review_mode")) {
		fail("open-code-review.md 应文档化 review_mode=log|comment");
	} else {
		ok("文档含 review_mode");
	}
}

if (process.exitCode) {
	console.error("ocr-eval: FAILED");
	process.exit(1);
}
console.log("ocr-eval: PASSED");
