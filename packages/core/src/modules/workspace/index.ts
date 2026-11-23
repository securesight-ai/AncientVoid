/** Public API of this module (ADR-0020). Other modules import only from here. */
export { discoverProjects, isProjectPathAllowed, ensureProjectDir, createProject, type DiscoveredProject, type ProjectDiscoveryResult, type CreateProjectResult } from "./projects.ts";
export { WorktreeManager, type WorktreeBaseChoice } from "./worktree.ts";
export { MainSyncSettingsService, type MainSyncKV } from "./main-sync-settings.ts";
export { MainSyncEngine, MAIN_SYNC_MERGE_MESSAGE, type MainSyncMeasure, type MainSyncDryRun, type MainSyncApplyOutcome } from "./main-sync-engine.ts";
export { MainSyncScheduler, type MainSyncCandidate, type MainSyncSchedulerNotice, type MainSyncSchedulerDeps } from "./main-sync-scheduler.ts";
export { resolveMainBranch, currentGitBranch, fetchMainBranch, classifyFetchError, originRemoteUrl } from "./main-sync-git.ts";
export { canonicalCheckout, checkoutState, CheckoutLeaseStore, type CheckoutLease } from "./checkout.ts";
export { resolveManifest, sha256, type ResolvedManifest } from "./manifest-resolver.ts";
export { ManifestApprovalStore, gateManifest, type ManifestApprovalInput, type ManifestApprovalRecord, type ManifestGate } from "./manifest-approval.ts";
export { copyIncludedFiles, DEFAULT_INCLUDE_LIMITS, type IncludeCopyReport, type IncludeCopyLimits } from "./include-copy.ts";
export {
  WorkspaceRuntime,
  foldWorkspaceState,
  type WorkspaceEmit,
  type WorkspaceRunInput,
  type WorkspaceRunResult,
  type WorkspaceOperationKind,
  type FoldedWorkspaceState,
} from "./workspace-runtime.ts";
export {
  ServiceSupervisor,
  type ServiceStartContext,
  type ServiceOutcome,
} from "./workspace-services.ts";
export {
  pruneWorktrees,
  scanWorktrees,
  type PruneResult,
  type WorktreeEntry,
  type WorktreeSessionRow,
  type WorktreeState,
} from "./worktree-hygiene.ts";
