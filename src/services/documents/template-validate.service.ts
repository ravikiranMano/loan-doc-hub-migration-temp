import { invokeValidateTemplate } from '@/services/supabase/functions';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';

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
  if (isNodeApiEnabled('documents')) {
    return apiClient.post<TemplateValidationResult>(`/templates/${templateId}/validate`, {});
  }
  return invokeValidateTemplate(templateId) as Promise<TemplateValidationResult>;
}
