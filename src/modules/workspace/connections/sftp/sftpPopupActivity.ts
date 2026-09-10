import type { TransferRecord } from "./types";

export type SftpPopupActivity = { pending: boolean; needsAttention: boolean };
export type SftpPopupProgress = SftpPopupActivity & { failed: number; batchFailed: boolean };
export const EMPTY_POPUP_PROGRESS: SftpPopupProgress = { pending: false, needsAttention: false, failed: 0, batchFailed: false };

export function nextSftpPopupProgress(
  previous: SftpPopupProgress,
  transfers: Pick<TransferRecord, "state">[],
  needsAttention: boolean,
  conflictPending: boolean,
) {
  const pending = conflictPending || transfers.some((transfer) => transfer.state === "active" || transfer.state === "queued");
  const failed = transfers.filter((transfer) => transfer.state === "failed").length;
  const newFailure = failed > previous.failed;
  const batchFailed = newFailure || (previous.pending && previous.batchFailed);
  const progress: SftpPopupProgress = { pending, needsAttention, failed, batchFailed };
  const notice = needsAttention && !previous.needsAttention
    ? "attention"
    : newFailure || (previous.pending && !pending && batchFailed)
      ? "failed"
      : previous.pending && !pending ? "finished" : undefined;
  return { progress, notice };
}
