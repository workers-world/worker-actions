#!/usr/bin/env node
/**
 * GHA debounce_flush job：等待至 firstSeen + DEBOUNCE_MS。
 * 环境变量：DEBOUNCE_FIRST_SEEN_AT（毫秒时间戳，必填）
 */
import { debounceFlushWaitMs, parseCooldownTimestamp } from './lib/release-pr-blocked-notify.mjs';

const first = parseCooldownTimestamp(process.env.DEBOUNCE_FIRST_SEEN_AT);
if (first == null) {
  process.stderr.write('debounce-flush-wait: missing or invalid DEBOUNCE_FIRST_SEEN_AT\n');
  process.exit(1);
}

const waitMs = debounceFlushWaitMs(first);
if (waitMs > 0) {
  process.stdout.write(`debounce-flush-wait: sleeping ${waitMs}ms\n`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
