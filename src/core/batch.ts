export type BatchOutcomeStatus = 'accepted' | 'rejected' | 'unresolved';

export type UnresolvedReason = 'NotReported' | 'StatusFailedWithoutError';

export interface AcceptedOutcome {
  outcome: 'accepted';
  index: number;
  emailId: string;
  status: string;
}

export interface RejectedOutcome {
  outcome: 'rejected';
  index: number;
  errorType: string;
  message: string;
}

export interface UnresolvedOutcome {
  outcome: 'unresolved';
  index: number;
  reason: UnresolvedReason;
}

export type BatchOutcome = AcceptedOutcome | RejectedOutcome | UnresolvedOutcome;

export interface BatchResult {
  batchId: string;
  outcomes: BatchOutcome[];
  accepted: AcceptedOutcome[];
  rejected: RejectedOutcome[];
  unresolved: UnresolvedOutcome[];
  acceptedEmailIds: string[];
  allAccepted: boolean;
  hasUnresolved: boolean;
  raw: unknown;
}

export function isAccepted(outcome: BatchOutcome): outcome is AcceptedOutcome {
  return outcome.outcome === 'accepted';
}

export function isRejected(outcome: BatchOutcome): outcome is RejectedOutcome {
  return outcome.outcome === 'rejected';
}

export function isUnresolved(outcome: BatchOutcome): outcome is UnresolvedOutcome {
  return outcome.outcome === 'unresolved';
}

interface DecodedBatchItem {
  index: number;
  status?: string;
  id?: string;
  error?: { type?: string; message?: string } | null;
}

interface DecodedBatchResponse {
  batchId?: string;
  results?: DecodedBatchItem[];
  errors?: { index: number; code?: string; message?: string }[];
}

export function normalizeBatch(raw: unknown, inputCount: number): BatchResult {
  const response = (raw ?? {}) as DecodedBatchResponse;
  const byIndex = new Map<number, BatchOutcome>();

  for (const item of response.results ?? []) {
    const index = item.index ?? -1;
    if (index < 0) continue;

    if (item.id && item.status !== 'failed') {
      byIndex.set(index, { outcome: 'accepted', index, emailId: item.id, status: item.status ?? 'pending' });
      continue;
    }

    if (item.error) {
      byIndex.set(index, {
        outcome: 'rejected',
        index,
        errorType: item.error.type ?? '',
        message: item.error.message ?? '',
      });
      continue;
    }

    byIndex.set(index, { outcome: 'unresolved', index, reason: 'StatusFailedWithoutError' });
  }

  for (const failure of response.errors ?? []) {
    const index = failure.index ?? -1;
    if (index < 0 || byIndex.has(index)) continue;

    byIndex.set(index, {
      outcome: 'rejected',
      index,
      errorType: failure.code ?? '',
      message: failure.message ?? '',
    });
  }

  const outcomes: BatchOutcome[] = [];
  for (let index = 0; index < inputCount; index += 1) {
    outcomes.push(byIndex.get(index) ?? { outcome: 'unresolved', index, reason: 'NotReported' });
  }

  const accepted = outcomes.filter(isAccepted);
  const rejected = outcomes.filter(isRejected);
  const unresolved = outcomes.filter(isUnresolved);

  return {
    batchId: response.batchId ?? '',
    outcomes,
    accepted,
    rejected,
    unresolved,
    acceptedEmailIds: accepted.map((o) => o.emailId),
    allAccepted: rejected.length === 0 && unresolved.length === 0,
    hasUnresolved: unresolved.length > 0,
    raw,
  };
}
