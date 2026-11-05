/** Re-export for unit tests; canonical copy lives in push-ci-admission composite action. */
export {
  listChangedFiles,
  listFilesForNewRef,
  listFilesSinceMergeBase,
  resolveDefaultBranchRef,
  shouldSkipPackagesJobsOnPush,
} from '../../.github/actions/push-ci-admission/push-ci-admission.mjs';
