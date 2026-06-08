import { downloadFile, STORAGE_BUCKETS } from '@/services/storage';
import { apiClient, apiFetch } from '@/services/client';

export interface GenerateDocumentBody {
  outputType: 'docx_only' | 'docx_and_pdf';
  templateId?: string;
  packetId?: string;
}

export interface GenerateDocumentResult {
  status?: string;
  jobId?: string;
  successCount: number;
  failCount: number;
  results: Array<{ templateName: string; success: boolean; error?: string }>;
}

export async function generateDocumentsAsync(
  dealId: string,
  body: GenerateDocumentBody,
): Promise<GenerateDocumentResult> {
  return apiClient.post<GenerateDocumentResult>(`/deals/${dealId}/documents/generate-edge`, body);
}

export interface DocumentPayloadPreviewResult {
  dealId: string;
  dealNumber?: string;
  templateId: string;
  templateName: string;
  fieldCount: number;
  totalKeysInMap: number;
  data: Record<string, unknown>;
  /** v2 only: conditionals from docxtemplater inspect. */
  templateConditions?: TemplateConditionV2[];
}

export interface GenerateDocumentApiResult {
  success: boolean;
  templateId?: string;
  templateName?: string;
  docxUrl?: string;
  error?: string;
}

/**
 * Generate Document — NestJS · docxtemplater engine · persists records.
 */
export async function generateDocument(
  dealId: string,
  body: GenerateDocumentBody,
): Promise<GenerateDocumentResult> {
  return apiClient.post<GenerateDocumentResult>(`/deals/${dealId}/documents/generate`, body);
}

/** Generate Document (API) — NestJS · raw XML merge-tag engine · persists records. */
export async function generateDocumentApi(
  dealId: string,
  body: GenerateDocumentBody,
): Promise<GenerateDocumentApiResult> {
  return apiClient.post<GenerateDocumentApiResult>(`/deals/${dealId}/documents/generate-api`, body);
}

/** Generate Document (Edge) — proxied via NestJS to the Deno edge function. */
export async function generateDocumentEdge(
  dealId: string,
  body: GenerateDocumentBody,
): Promise<GenerateDocumentApiResult> {
  return apiClient.post<GenerateDocumentApiResult>(`/deals/${dealId}/documents/generate-edge`, body);
}

/** Merge field map that would be sent to the DOCX engine (same pipeline as generate, stops before merge). */
export async function previewDocumentPayload(
  dealId: string,
  templateId: string,
): Promise<DocumentPayloadPreviewResult> {
  const q = encodeURIComponent(templateId);
  return apiClient.get<DocumentPayloadPreviewResult>(
    `/deals/${dealId}/documents/preview-payload?templateId=${q}`,
  );
}

export async function listGeneratedDocuments(dealId?: string) {
  if (!dealId) return [];
  return apiClient.get<unknown[]>(`/deals/${dealId}/documents`);
}

export async function listGeneratedDocumentsByDealIds(dealIds: string[]) {
  if (!dealIds.length) return [];
  return apiClient.get<unknown[]>(
    `/documents/generated?dealIds=${dealIds.map((id) => encodeURIComponent(id)).join(',')}`,
  );
}

export async function listGenerationJobs(dealId: string) {
  return apiClient.get<unknown[]>(`/deals/${dealId}/documents/jobs`);
}

export async function deleteGeneratedDocumentsByTemplate(templateId: string) {
  return apiClient.delete(`/templates/${templateId}/generated-documents`);
}

export async function deleteGenerationJobsByTemplate(templateId: string) {
  return apiClient.delete(`/templates/${templateId}/generation-jobs`);
}

export async function deletePacketTemplatesByTemplate(templateId: string) {
  return apiClient.delete(`/templates/${templateId}/packet-templates`);
}

export async function deleteTemplateFieldMapsByTemplate(templateId: string) {
  return apiClient.delete(`/templates/${templateId}/field-maps`);
}

export async function downloadGeneratedDoc(path: string) {
  return downloadFile(STORAGE_BUCKETS.generatedDocs, path);
}

// ─── v2: docxtemplater engine ─────────────────────────────────────────────────

export interface TemplateConditionV2 {
  expression: string;
  driverField: string | null;
  operator: string | null;
  compareValue: string | null;
  fieldKeys: string[];
  driverValue?: string;
  driverResolved?: boolean;
  matchesCompare?: boolean;
}

export interface FieldDataV2Result {
  data: Record<string, unknown>;
  metadata: {
    dealId: string;
    dealNumber: string;
    templateId: string;
    templateName: string;
    filePath: string;
    fieldMapCount: number;
    resolvedCount: number;
    templateTagKeys?: string[];
    templateResolvedCount?: number;
    templateConditions?: TemplateConditionV2[];
    templateTagTree?: Record<string, unknown>;
    valueSource?: string;
  };
}

/** Returns the fully-resolved JSON that would be passed to docxtemplater for inspection. */
export async function getFieldDataV2(dealId: string, templateId: string): Promise<FieldDataV2Result> {
  const q = encodeURIComponent(templateId);
  return apiClient.get<FieldDataV2Result>(`/deals/${dealId}/documents/field-data-v2?templateId=${q}`);
}

/**
 * Generates a DOCX via the docxtemplater engine (v2) and triggers a browser download.
 * Returns the template name so the caller can show feedback.
 */
export async function generateDocumentV2(dealId: string, templateId: string): Promise<string> {
  const res = await apiFetch(`/deals/${dealId}/documents/generate-v2`, {
    method: 'POST',
    body: JSON.stringify({ templateId }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message ?? `v2 generation failed (${res.status})`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'generated_v2.docx';

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return filename;
}
