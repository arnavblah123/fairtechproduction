import type { AttachmentKind } from "@prisma/client";

// Per-file cap. Files live in Postgres (keeps the app a single deployable
// with zero file-storage cost); keep drawings/BOMs to sensible sizes.
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  DRAWING: "Drawing",
  BOM: "Bill of Material",
  OTHER: "Other",
};

export type PendingAttachment = {
  kind: AttachmentKind;
  filename: string;
  mimeType: string;
  size: number;
  data: Uint8Array<ArrayBuffer>;
};

// Read uploaded form files into buffers, validating size. Throws with a
// user-facing message when a file is over the cap.
export async function readUploadedFiles(
  files: FormDataEntryValue[],
  kind: AttachmentKind
): Promise<PendingAttachment[]> {
  const out: PendingAttachment[] = [];
  for (const entry of files) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (entry.size > ATTACHMENT_MAX_BYTES) {
      throw new Error(
        `"${entry.name}" is ${formatFileSize(entry.size)} — the limit is ${formatFileSize(ATTACHMENT_MAX_BYTES)} per file.`
      );
    }
    out.push({
      kind,
      filename: entry.name,
      mimeType: entry.type || "application/octet-stream",
      size: entry.size,
      data: new Uint8Array(await entry.arrayBuffer()),
    });
  }
  return out;
}
