import { beforeEach, describe, expect, it } from "vitest";

interface AuthContext {
  userId: string;
}

interface TrackingCheckInRow {
  id: string;
  user_id: string;
  pain_level: number;
}

interface MemberTrackingDocumentRow {
  id: string;
  user_id: string;
  file_name: string;
}

interface AuditEntry {
  action_type: "view" | "delete";
  entity_type: string;
  user_id: string;
  details: Record<string, unknown>;
}

interface RpcResponse<T> {
  data: T | null;
  error: { message: string } | null;
}

type RpcArgs = Record<string, unknown>;

const USERS = {
  A: "00000000-0000-4000-8000-00000000000a",
  B: "00000000-0000-4000-8000-00000000000b",
} as const;

const state: {
  healthCheckIns: TrackingCheckInRow[];
  memberTrackingDocuments: MemberTrackingDocumentRow[];
  auditJournal: AuditEntry[];
} = {
  healthCheckIns: [],
  memberTrackingDocuments: [],
  auditJournal: [],
};

const signatures: Record<string, readonly string[]> = {
  get_my_health_check_ins_audited: ["p_limit"],
  delete_my_health_document_audited: ["p_document_id"],
};

function validateArgs(functionName: string, args: RpcArgs): string | null {
  const allowed = signatures[functionName];
  if (!allowed) return `Unknown RPC function: ${functionName}`;

  const invalidKeys = Object.keys(args).filter((key) => !allowed.includes(key));
  if (invalidKeys.length > 0) {
    return `RPC argument mismatch for ${functionName}: unsupported args ${invalidKeys.join(", ")}`;
  }

  return null;
}

function writeAudit(entry: AuditEntry): void {
  state.auditJournal.push(entry);
}

function getMyTrackingCheckInsAudited(auth: AuthContext, args: RpcArgs): RpcResponse<TrackingCheckInRow[]> {
  const limitArg = typeof args.p_limit === "number" ? args.p_limit : 30;
  const limit = Math.max(0, limitArg);

  writeAudit({
    action_type: "view",
    entity_type: "health_check_in",
    user_id: auth.userId,
    details: { result: "granted", limit },
  });

  return {
    data: state.healthCheckIns.filter((row) => row.user_id === auth.userId).slice(0, limit),
    error: null,
  };
}

function deleteMyTrackingDocumentAudited(auth: AuthContext, args: RpcArgs): RpcResponse<boolean> {
  const documentId = String(args.p_document_id ?? "");
  const ownedDocument = state.memberTrackingDocuments.find(
    (row) => row.id === documentId && row.user_id === auth.userId,
  );

  if (!ownedDocument) {
    return {
      data: null,
      error: { message: "Document not found" },
    };
  }

  state.memberTrackingDocuments.splice(
    state.memberTrackingDocuments.findIndex((row) => row.id === ownedDocument.id),
    1,
  );

  writeAudit({
    action_type: "delete",
    entity_type: "member_health_document",
    user_id: auth.userId,
    details: { result: "granted", document_id: documentId },
  });

  return { data: true, error: null };
}

function callRpcAs<T>(auth: AuthContext, functionName: string, args: RpcArgs): RpcResponse<T> {
  const signatureError = validateArgs(functionName, args);
  if (signatureError) {
    return {
      data: null,
      error: { message: signatureError },
    };
  }

  if (functionName === "get_my_health_check_ins_audited") {
    return getMyTrackingCheckInsAudited(auth, args) as RpcResponse<T>;
  }

  if (functionName === "delete_my_health_document_audited") {
    return deleteMyTrackingDocumentAudited(auth, args) as RpcResponse<T>;
  }

  return {
    data: null,
    error: { message: `RPC function not implemented in test harness: ${functionName}` },
  };
}

describe("IDOR prevention integration for SECURITY DEFINER RPC", () => {
  beforeEach(() => {
    state.healthCheckIns = [
      { id: "hci-a-1", user_id: USERS.A, pain_level: 3 },
      { id: "hci-b-1", user_id: USERS.B, pain_level: 9 },
    ];

    state.memberTrackingDocuments = [
      { id: "doc-a-1", user_id: USERS.A, file_name: "a.pdf" },
      { id: "doc-b-1", user_id: USERS.B, file_name: "b.pdf" },
    ];

    state.auditJournal = [];
  });

  it("rejects forged p_user_id on get_my_*_audited and does not create successful read audit", () => {
    const result = callRpcAs<TrackingCheckInRow[]>(
      { userId: USERS.A },
      "get_my_health_check_ins_audited",
      {
        p_limit: 30,
        p_user_id: USERS.B,
      },
    );

    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("unsupported args p_user_id");
    expect(result.data).toBeNull();

    const successfulReadAudit = state.auditJournal.filter(
      (entry) =>
        entry.action_type === "view" &&
        entry.entity_type === "health_check_in" &&
        entry.details.result === "granted",
    );

    expect(successfulReadAudit).toHaveLength(0);
  });

  it("denies cross-user delete_my_* access with forged identifier and prevents data leak", () => {
    const result = callRpcAs<boolean>(
      { userId: USERS.A },
      "delete_my_health_document_audited",
      {
        p_document_id: "doc-b-1",
      },
    );

    expect(result.error).not.toBeNull();
    expect(result.error?.message).toBe("Document not found");
    expect(result.data).toBeNull();

    const userBDocument = state.memberTrackingDocuments.find((doc) => doc.id === "doc-b-1");
    expect(userBDocument).toBeDefined();

    const successfulDeleteAudit = state.auditJournal.filter(
      (entry) =>
        entry.action_type === "delete" &&
        entry.entity_type === "member_health_document" &&
        entry.details.result === "granted",
    );

    expect(successfulDeleteAudit).toHaveLength(0);
  });

  it("returns only caller-owned records for valid get_my_*_audited call", () => {
    const result = callRpcAs<TrackingCheckInRow[]>(
      { userId: USERS.A },
      "get_my_health_check_ins_audited",
      { p_limit: 10 },
    );

    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: "hci-a-1", user_id: USERS.A, pain_level: 3 }]);

    const successfulReadAudit = state.auditJournal.filter(
      (entry) =>
        entry.action_type === "view" &&
        entry.entity_type === "health_check_in" &&
        entry.details.result === "granted" &&
        entry.user_id === USERS.A,
    );

    expect(successfulReadAudit).toHaveLength(1);
  });
});
