#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseConsumersResponse,
  repoShortName,
  resolveConsumerMatrix,
} from "./fetch-consumers.mjs";

test("repoShortName extracts repo segment", () => {
  assert.equal(repoShortName("workers-world/mok1"), "mok1");
  assert.equal(repoShortName(" workers-world/tal1 "), "tal1");
});

test("parseConsumersResponse: bare array of strings", () => {
  const rows = parseConsumersResponse(["workers-world/b", "workers-world/a"]);
  assert.deepEqual(rows, [
    { repo: "workers-world/a", short_name: "a" },
    { repo: "workers-world/b", short_name: "b" },
  ]);
});

test("parseConsumersResponse: consumers object rows", () => {
  const rows = parseConsumersResponse({
    consumers: [
      { repo: "workers-world/mok1", status: "upgradable" },
      { full_name: "workers-world/tal1" },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].repo, "workers-world/mok1");
  assert.equal(rows[1].short_name, "tal1");
});

test("parseConsumersResponse: dedupes", () => {
  const rows = parseConsumersResponse({
    items: ["workers-world/mok1", { repo: "workers-world/mok1" }],
  });
  assert.deepEqual(rows, [{ repo: "workers-world/mok1", short_name: "mok1" }]);
});

test("resolveConsumerMatrix: CONSUMER_REPO override skips fetch", async () => {
  let fetchCalled = false;
  const resolved = await resolveConsumerMatrix({
    consumerRepo: "workers-world/mok1",
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response("[]");
    },
  });
  assert.equal(fetchCalled, false);
  assert.equal(resolved.mode, "override");
  assert.deepEqual(resolved.consumers, [{ repo: "workers-world/mok1", short_name: "mok1" }]);
});

test("resolveConsumerMatrix: API path uses fetch", async () => {
  const body = JSON.stringify({ consumers: [{ repo: "workers-world/foo" }] });
  const resolved = await resolveConsumerMatrix({
    token: "test-token",
    apiBase: "https://example.test",
    dep: "worker-actions",
    status: "upgradable",
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/v1\/consumers\?dep=worker-actions&status=upgradable$/);
      assert.equal(init.headers.Authorization, "Bearer test-token");
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(resolved.mode, "api");
  assert.deepEqual(resolved.consumers, [{ repo: "workers-world/foo", short_name: "foo" }]);
});
