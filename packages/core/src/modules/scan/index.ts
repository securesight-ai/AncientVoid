/** Public API of this module (ADR-0020). Other modules import only from here. */
export { ScanService, type ScanServiceConfig, type ScanServiceDeps, type ScanCall } from "./service.ts";
export { createScanJournal, type ScanJournal, type JournalDeps } from "./journal.ts";
export { createScanHttpBackend, ScanBackendError, type ScanBackend, type ScanBackendDeps, type ScanBackendErrorState } from "./backend.ts";
