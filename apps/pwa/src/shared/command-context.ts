/**
 * T9.4: what the text entry needs to know about "here" — the page, the
 * open session, and the text field last used. Fields register themselves;
 * the command bar reads and writes them (fill, transform, undo).
 */
export type FieldId = "reply" | "new_prompt" | "session_title" | "code_query" | "session_filter";

export interface FieldHandle {
  get(): string;
  set(text: string): void;
}

interface Here {
  page: "dashboard" | "new" | "settings" | "approvals" | "status" | "media" | "pc" | "vault" | "teams" | "automationen" | "aimetrics" | "inference" | "statistics" | "terminal" | "releasenotes" | "pentest" | "session";
  hostId: string | null;
  sessionId: string | null;
  sessionRevision: number | null;
}

let here: Here = { page: "dashboard", hostId: null, sessionId: null, sessionRevision: null };
const fields = new Map<FieldId, FieldHandle>();
let lastField: FieldId | null = null;

export function setHere(next: Partial<Here>): void {
  here = { ...here, ...next };
}

export function getHere(): Here {
  return here;
}

/** A field announces itself (on mount) and when it is used (focus). */
export function registerField(id: FieldId, handle: FieldHandle): () => void {
  fields.set(id, handle);
  return () => {
    if (fields.get(id) === handle) fields.delete(id);
    if (lastField === id) lastField = null;
  };
}

export function touchField(id: FieldId): void {
  lastField = id;
}

export function field(id: FieldId | null): FieldHandle | undefined {
  return id ? fields.get(id) : undefined;
}

/** The field a text edit means: the last one used, else the reply field. */
export function currentField(): FieldId | null {
  if (lastField && fields.has(lastField)) return lastField;
  if (fields.has("reply")) return "reply";
  if (fields.has("new_prompt")) return "new_prompt";
  return null;
}

/** Context sent with a plan (CommandContext in contracts). */
export function commandContext(): Record<string, unknown> {
  const f = currentField();
  return {
    page: here.page,
    hostId: here.hostId,
    sessionId: here.sessionId,
    sessionRevision: here.sessionRevision,
    field: f,
    fieldText: f ? (fields.get(f)?.get() ?? null) : null,
  };
}
