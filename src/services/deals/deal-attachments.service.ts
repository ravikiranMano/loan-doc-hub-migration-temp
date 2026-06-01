import {
  fetchSectionValueByDealAndSection,
} from '@/services/deals/section-values.service';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';
import { fetchProfilesByUserIds } from '@/services/admin/profiles.service';
import {
  STORAGE_BUCKETS,
  uploadFile,
  downloadFile,
  removeFiles,
} from '@/services/supabase/storage';

export const DEAL_ATTACHMENTS_SECTION = 'attachments_grid';
export const DEAL_ATTACHMENTS_BUCKET = STORAGE_BUCKETS.contactAttachments;

export interface DealAttachmentMeta {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: string;
  category: string;
  description: string;
  uploaded_by: string;
  uploader_name?: string;
  uploaded_at: string;
}

export interface DealAttachmentsGridRow {
  rowId: string | null;
  version: number;
  files: DealAttachmentMeta[];
}

export async function fetchDealAttachmentsGrid(dealId: string): Promise<DealAttachmentsGridRow> {
  const row = (await fetchSectionValueByDealAndSection(dealId, DEAL_ATTACHMENTS_SECTION)) as {
    id?: string;
    field_values?: { files?: DealAttachmentMeta[] };
    version?: number;
  } | null;

  const files = Array.isArray(row?.field_values?.files) ? row!.field_values!.files! : [];
  const uploaderIds = [...new Set(files.map((f) => f.uploaded_by).filter(Boolean))];
  let nameMap: Record<string, string> = {};

  if (uploaderIds.length) {
    const profiles = await fetchProfilesByUserIds(uploaderIds);
    nameMap = Object.fromEntries(
      profiles.map((p) => [p.user_id, p.full_name || p.email || 'Unknown']),
    );
  }

  return {
    rowId: row?.id ?? null,
    version: row?.version ?? 0,
    files: files.map((f) => ({
      ...f,
      uploader_name: nameMap[f.uploaded_by] || f.uploader_name || 'Unknown',
    })),
  };
}

export async function saveDealAttachmentsGrid(
  dealId: string,
  files: DealAttachmentMeta[],
): Promise<void> {
  if (isNodeApiEnabled('deals')) {
    await apiClient.patch(`/deals/${dealId}/sections/${DEAL_ATTACHMENTS_SECTION}`, {
      field_values: { files },
    });
    return;
  }
  const { error } = await supabase.from('deal_section_values').upsert({
    deal_id: dealId,
    section: DEAL_ATTACHMENTS_SECTION,
    field_values: { files },
    version: 1,
  });
  if (error) throw error;
}

export async function uploadDealAttachmentFile(dealId: string, file: File): Promise<string> {
  const path = `deal/${dealId}/${crypto.randomUUID()}_${file.name}`;
  await uploadFile(DEAL_ATTACHMENTS_BUCKET, path, file);
  return path;
}

export async function removeDealAttachmentFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await removeFiles(DEAL_ATTACHMENTS_BUCKET, paths);
}

export async function downloadDealAttachmentFile(path: string): Promise<Blob> {
  return downloadFile(DEAL_ATTACHMENTS_BUCKET, path);
}
