#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { compareSdkVersions, rewriteSdkPinContent } from "./rewrite-sdk-pin.mjs";

const PKG = (workerVersion) =>
  JSON.stringify({
    name: "demo",
    dependencies: {
      framework_sdk_worker: workerVersion,
      hono: "^4.0.0",
    },
    devDependencies: {
      framework_sdk_ui: "npm:@workers-world/framework_sdk_ui@0.1.30",
    },
  });

test("rewrites only the target sdk alias pin", () => {
  const { content, replacements, currentVersion } = rewriteSdkPinContent(
    PKG("npm:@workers-world/framework_sdk_worker@0.4.55"),
    "framework_sdk_worker",
    "0.4.56",
  );
  assert.equal(replacements, 1);
  assert.equal(currentVersion, "0.4.55");
  const parsed = JSON.parse(content);
  assert.equal(
    parsed.dependencies.framework_sdk_worker,
    "npm:@workers-world/framework_sdk_worker@0.4.56",
  );
  assert.equal(parsed.dependencies.hono, "^4.0.0");
  assert.equal(
    parsed.devDependencies.framework_sdk_ui,
    "npm:@workers-world/framework_sdk_ui@0.1.30",
  );
});

test("noop when already at target", () => {
  const src = PKG("npm:@workers-world/framework_sdk_worker@0.4.56");
  const { content, replacements, currentVersion } = rewriteSdkPinContent(
    src,
    "framework_sdk_worker",
    "0.4.56",
  );
  assert.equal(replacements, 0);
  assert.equal(currentVersion, "0.4.56");
  assert.equal(content, src);
});

test("reports current version for downgrade guard", () => {
  const { currentVersion } = rewriteSdkPinContent(
    PKG("npm:@workers-world/framework_sdk_worker@0.5.0"),
    "framework_sdk_worker",
    "0.4.56",
  );
  assert.equal(currentVersion, "0.5.0");
  assert.equal(compareSdkVersions("0.5.0", "0.4.56"), 1);
  assert.equal(compareSdkVersions("0.4.56", "0.4.56"), 0);
  assert.equal(compareSdkVersions("0.4.55", "0.4.56"), -1);
});

test("non-alias range pins are left untouched", () => {
  const src = JSON.stringify({
    dependencies: { framework_sdk_worker: "file:../framework_sdk_worker" },
  });
  const { replacements, currentVersion } = rewriteSdkPinContent(
    src,
    "framework_sdk_worker",
    "0.4.56",
  );
  assert.equal(replacements, 0);
  assert.equal(currentVersion, null);
});
