#!/usr/bin/env node
/**
 * Deploy-tracker consumers API client (WW-151 Phase 1 API; dep=worker-actions Phase 2).
 * GET {CONSUMERS_API_BASE}/v1/consumers?dep=&status=
 * Authorization: Bearer {RULES_ADMIN_TOKEN} (same token as registry rules admin).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CONSUMERS_API_BASE = "https://deploy.mailworld.uk";
export const DEFAULT_CONSUMERS_DEP = "worker-actions";
export const DEFAULT_CONSUMERS_STATUS = "upgradable";

/**
 * @param {string} fullName owner/repo
 * @returns {string} repo name segment for release-bot repositories: scope
 */
export function repoShortName(fullName) {
  const trimmed = (fullName || "").trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(`Invalid consumer repo (expected owner/name): ${fullName}`);
  }
  return trimmed.slice(slash + 1);
}

/**
 * @param {unknown} entry API row or bare repo string
 * @returns {string | null} owner/name
 */
export function normalizeConsumerRepo(entry) {
  if (typeof entry === "string") {
    const s = entry.trim();
    return s || null;
  }
  if (entry && typeof entry === "object") {
    const o = /** @type {Record<string, unknown>} */ (entry);
    const candidate =
      o.repo ??
      o.full_name ??
      o.fullName ??
      o.github_repo ??
      o.githubRepo ??
      o.name;
    if (typeof candidate === "string" && candidate.includes("/")) {
      return candidate.trim();
    }
  }
  return null;
}

const REPO_FULL_NAME = /^[\w.-]+\/[\w.-]+$/;

/**
 * @param {unknown} body parsed JSON or JSON string
 * @returns {{ repo: string, short_name: string }[]}
 */
export function parseConsumersResponse(body) {
  let data = body;
  if (typeof body === "string") {
    data = JSON.parse(body);
  }

  /** @type {unknown[]} */
  let list;
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === "object") {
    const o = /** @type {Record<string, unknown>} */ (data);
    if (Array.isArray(o.consumers)) list = o.consumers;
    else if (Array.isArray(o.items)) list = o.items;
    else if (Array.isArray(o.data)) list = o.data;
    else throw new Error("Unrecognized consumers API payload (expected array or consumers/items/data)");
  } else {
    throw new Error("Unrecognized consumers API payload");
  }

  /** @type {{ repo: string, short_name: string }[]} */
  const out = [];
  const seen = new Set();
  for (const entry of list) {
    const repo = normalizeConsumerRepo(entry);
    if (!repo || !REPO_FULL_NAME.test(repo)) continue;
    if (seen.has(repo)) continue;
    seen.add(repo);
    out.push({ repo, short_name: repoShortName(repo) });
  }
  out.sort((a, b) => a.repo.localeCompare(b.repo));
  return out;
}

/**
 * @param {{
 *   apiBase?: string,
 *   dep?: string,
 *   status?: string,
 *   token?: string,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 */
export async function fetchUpgradableConsumers(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = (options.apiBase ?? process.env.CONSUMERS_API_BASE ?? DEFAULT_CONSUMERS_API_BASE).replace(
    /\/$/,
    "",
  );
  const dep = options.dep ?? process.env.CONSUMERS_DEP ?? DEFAULT_CONSUMERS_DEP;
  const status = options.status ?? process.env.CONSUMERS_STATUS ?? DEFAULT_CONSUMERS_STATUS;
  const token =
    options.token ?? process.env.RULES_ADMIN_TOKEN ?? process.env.CONSUMERS_API_TOKEN;

  if (!token) {
    throw new Error(
      "RULES_ADMIN_TOKEN required to call deploy-tracker consumers API (Org Secret on worker-actions)",
    );
  }

  const url = `${base}/v1/consumers?${new URLSearchParams({ dep, status }).toString()}`;
  const res = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Consumers API ${url} → HTTP ${res.status}: ${text.slice(0, 400)}`,
    );
  }

  let parsed;
  try {
    parsed = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(`Consumers API returned non-JSON body: ${text.slice(0, 200)}`);
  }

  return {
    dep,
    status,
    apiBase: base,
    consumers: parseConsumersResponse(parsed),
  };
}

/**
 * Single-repo override (pilot / debug) or consumers API fanout.
 * @returns {Promise<{ mode: "override" | "api", consumers: { repo: string, short_name: string }[], dep?: string, status?: string }>}
 */
export async function resolveConsumerMatrix(options = {}) {
  const override = (options.consumerRepo ?? process.env.CONSUMER_REPO ?? "").trim();
  if (override) {
    if (!REPO_FULL_NAME.test(override)) {
      throw new Error(`CONSUMER_REPO must be owner/name, got: ${override}`);
    }
    return {
      mode: "override",
      consumers: [{ repo: override, short_name: repoShortName(override) }],
    };
  }

  const { dep, status, consumers } = await fetchUpgradableConsumers(options);
  return { mode: "api", dep, status, consumers };
}

function emptyApiMessage(dep, status, apiBase) {
  return [
    `Consumers API returned zero repos for dep=${dep} status=${status} (${apiBase}).`,
    "Org fanout needs deploy-tracker Phase 2 (dep=worker-actions) and worker-actions secrets:",
    "  CONSUMERS_API_BASE (Variable, optional — default https://deploy.mailworld.uk),",
    "  RULES_ADMIN_TOKEN (Secret — Bearer, same as registry rules admin).",
    "To debug a single repo without the API, set workflow_dispatch consumer_repo or Org Variable CONSUMER_REPO=workers-world/<repo>.",
  ].join(" ");
}

async function main() {
  const outFile = process.env.GITHUB_OUTPUT;
  try {
    const resolved = await resolveConsumerMatrix();
    const { consumers, mode, dep, status } = resolved;

    if (consumers.length === 0) {
      const apiBase =
        process.env.CONSUMERS_API_BASE?.replace(/\/$/, "") ?? DEFAULT_CONSUMERS_API_BASE;
      const msg = emptyApiMessage(dep ?? DEFAULT_CONSUMERS_DEP, status ?? DEFAULT_CONSUMERS_STATUS, apiBase);
      console.error(`::error::${msg}`);
      process.exit(1);
    }

    console.log(
      `::notice title=consumer-actions-bump::Resolved ${consumers.length} consumer(s) via ${mode}${
        mode === "api" ? ` (dep=${dep}, status=${status})` : ` (${consumers[0].repo})`
      }`,
    );

    const matrixJson = JSON.stringify(consumers);
    console.log(JSON.stringify({ mode, count: consumers.length, consumers }, null, 2));

    if (outFile) {
      fs.appendFileSync(outFile, `matrix=${matrixJson}\n`);
      fs.appendFileSync(outFile, `consumer_count=${consumers.length}\n`);
      fs.appendFileSync(outFile, `resolve_mode=${mode}\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`::error::${msg}`);
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
