import { apiClient } from '@/services/node-api/client';

export interface TemplateValidationResult {
  valid: boolean;
  totalTagsFound: number;
  mappedTags: string[];
  unmappedTags: string[];
  warnings: string[];
  errors: string[];
  summary: string;
  conditions?: unknown[];
}

export async function validateTemplate(templateId: string): Promise<TemplateValidationResult> {
  return apiClient.post<TemplateValidationResult>(`/templates/${templateId}/validate`, {});
}
