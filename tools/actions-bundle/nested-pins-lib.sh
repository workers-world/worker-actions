# Shared helpers for bundle nested @actions/v* pin rewrites (release-actions-bundle Phase A/B).
# shellcheck shell=bash
BUNDLE_PIN_GLOBS=(.github/actions .github/workflows templates docs/templates)

rewrite_nested_pins() {
  local target_tag="$1"
  shift
  local globs=("$@")
  local changed=0
  while IFS= read -r -d '' f; do
    if grep -qE '@actions/v[0-9]+\.[0-9]+\.[0-9]+' "$f"; then
      sed -i -E "s|@actions/v[0-9]+\.[0-9]+\.[0-9]+|@${target_tag}|g" "$f"
      changed=1
    fi
  done < <(
    find "${globs[@]}" -type f \( -name '*.yml' -o -name '*.yaml' \) -print0 2>/dev/null || true
  )
  if [ "$changed" = 1 ]; then
    echo "Rewrote nested @actions/v* pins → @${target_tag} under: ${globs[*]}"
  else
    echo "No @actions/v* pins to rewrite under: ${globs[*]}"
  fi
}

collect_inner_pin_versions() {
  grep -rhoE '@actions/v[0-9]+\.[0-9]+\.[0-9]+' \
    "${BUNDLE_PIN_GLOBS[@]}" \
    --include='*.yml' --include='*.yaml' 2>/dev/null | sort -u || true
}

# Latest actions/v* tag on origin (authoritative). Falls back to local tags.
# Prefer ls-remote so deleted tags (e.g. accidental mint then drop, #294) are not
# treated as "latest published" just because a stale local ref remains.
latest_actions_tag() {
  local remote
  remote="$(
    git ls-remote --tags --refs origin 'refs/tags/actions/v*' 2>/dev/null \
      | awk '{print $2}' \
      | sed 's#^refs/tags/##' \
      | sort -V \
      | tail -1 || true
  )"
  if [ -n "$remote" ]; then
    printf '%s\n' "$remote"
    return 0
  fi
  git tag -l 'actions/v*' --sort=-v:refname | head -1 || true
}

# Exit 0 if refs/tags/$1 exists on origin.
remote_actions_tag_exists() {
  local tag="$1"
  [ -n "$tag" ] || return 1
  git ls-remote --tags --refs origin "refs/tags/${tag}" 2>/dev/null | grep -q .
}

next_patch_actions_tag() {
  local latest="$1"
  [ -n "$latest" ] || return 0
  local ver="${latest#actions/v}"
  local maj min pat
  IFS=. read -r maj min pat <<< "${ver}"
  echo "actions/v${maj}.${min}.$((pat + 1))"
}

# Exit 0 when inner pins satisfy workflow-lint (single version = latest or patch+1).
destin_pins_lint_aligned() {
  local latest="$1"
  local versions
  versions="$(collect_inner_pin_versions)"
  local n
  n="$(printf '%s\n' "${versions}" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "$n" -eq 0 ]; then
    echo "ok: no nested @actions pins"
    return 0
  fi
  if [ "$n" -gt 1 ]; then
    echo "misaligned: multiple inner pin versions"
    printf '%s\n' "${versions}" | sed 's/^/  /'
    return 1
  fi
  local pin="${versions}"
  local pin_tag="${pin#@}"
  if [ -z "$latest" ]; then
    echo "ok: inner pin ${pin_tag}; no actions/v* tags yet"
    return 0
  fi
  local next
  next="$(next_patch_actions_tag "$latest")"
  if [ "$pin_tag" = "$latest" ] || [ "$pin_tag" = "$next" ]; then
    echo "ok: inner pin ${pin_tag} (latest=${latest}, next=${next})"
    return 0
  fi
  echo "lag: inner pin ${pin_tag} behind latest=${latest} (allowed next=${next})"
  return 1
}

update_manifest_for_tag() {
  local tag="$1"
  local manifest="${2:-manifest/actions-bundle.yaml}"
  local ref
  ref="$(git rev-list -n 1 "$tag" 2>/dev/null || true)"
  if [ -z "$ref" ]; then
    echo "::warning::Tag ${tag} not found locally; skip manifest update"
    return 0
  fi
  local today
  today="$(date -u +%Y-%m-%d)"
  mkdir -p "$(dirname "$manifest")"
  {
    echo "# Actions bundle 当前版本（Worker 仓 pin 此 tag）"
    echo "# 完整变更见 docs/actions-releases.md；权威来源为 git tag"
    echo "current: ${tag}"
    echo "sha: \"${ref}\""
    echo "released_at: \"${today}\""
    echo "notes: |"
    echo "  Destin auto-align nested pins to published tag (WW-303)."
  } > "$manifest"
  echo "Updated ${manifest} → current=${tag} sha=${ref}"
}

# Manifest current/sha/released_at vs local git facts (workflow-lint).
# Decision mirror of tools/actions-bundle/manifest-sha.mjs#checkManifestReleaseConsistency:
# - tag present: sha must equal peel (rev-list -n 1) (#205)
# - tag absent + released_at set: fail — claims published but tag gone / never pushed (#293)
# - tag absent + no released_at: skip (dev PR may lead tag)
# - sha must resolve to a local commit object when we are enforcing
# Exit 0 on ok/skip; exit 1 on inconsistency.
check_manifest_sha_matches_tag() {
  local manifest="${1:-manifest/actions-bundle.yaml}"
  if [ ! -f "$manifest" ]; then
    echo "skip: no ${manifest}"
    return 0
  fi
  local cur sha released_at
  cur="$(grep -E '^current:' "$manifest" | head -1 | awk '{print $2}' || true)"
  sha="$(grep -E '^sha:' "$manifest" | head -1 | sed -E 's/^sha:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/' || true)"
  released_at="$(grep -E '^released_at:' "$manifest" | head -1 | sed -E 's/^released_at:[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/' || true)"
  if [ -z "$cur" ] || [ -z "$sha" ]; then
    echo "skip: manifest missing current/sha"
    return 0
  fi

  local tag_present=0 peel="" sha_reachable=0
  if git rev-parse --verify "$cur" >/dev/null 2>&1; then
    tag_present=1
    peel="$(git rev-list -n 1 "$cur")"
  fi
  if git cat-file -e "${sha}^{commit}" 2>/dev/null; then
    sha_reachable=1
  fi

  if [ "$tag_present" -eq 0 ]; then
    if [ -n "$released_at" ]; then
      if [ "$sha_reachable" -eq 0 ]; then
        echo "::error::manifest current=${cur} released_at=${released_at} 声称已发布，但 tag 不存在，且 sha=${sha} 不可达（见 worker-actions#293）"
      else
        echo "::error::manifest current=${cur} released_at=${released_at} 声称已发布，但 tag 不存在（可能已删除或从未 push；见 worker-actions#293）"
      fi
      return 1
    fi
    echo "skip: tag ${cur} not present locally（发版前 manifest 可领先 tag）"
    return 0
  fi
  if [ "$sha" != "$peel" ]; then
    echo "::error::manifest sha=${sha} 与 ${cur} peel=${peel} 不一致（见 worker-actions#205）"
    return 1
  fi
  if [ "$sha_reachable" -eq 0 ]; then
    echo "::error::manifest sha=${sha} 不可达（无对应 commit 对象；见 worker-actions#293）"
    return 1
  fi
  echo "ok: manifest sha matches ${cur} peel ${peel}"
  return 0
}
