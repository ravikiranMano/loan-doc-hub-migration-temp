/**
 * Shared Types for Edge Functions
 * 
 * Common interfaces and type definitions used across
 * generate-document, validate-template, and other edge functions.
 */

export type OutputType = "docx_only" | "docx_and_pdf";
export type RequestType = "single_doc" | "packet";
export type GenerationStatus = "queued" | "running" | "success" | "failed";

export interface GenerateDocumentRequest {
  dealId: string;
  templateId?: string;  // For single doc
  packetId?: string;    // For packet generation
  outputType?: OutputType;
}

export interface TemplateFieldMap {
  field_dictionary_id: string;
  field_key: string;
  transform_rule: string | null;
  required_flag: boolean;
}

export interface FieldDefinition {
  id: string;
  field_key: string;
  data_type: string;
  label: string;
}

export interface DealFieldValue {
  field_dictionary_id: string;
  field_key: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
}

export interface Template {
  id: string;
  name: string;
  file_path: string | null;
}

export interface GenerationResult {
  templateId: string;
  templateName: string;
  success: boolean;
  documentId?: string;
  versionNumber?: number;
  outputPath?: string;
  error?: string;
}

export interface JobResult {
  jobId: string;
  dealId: string;
  requestType: RequestType;
  status: GenerationStatus;
  results: GenerationResult[];
  successCount: number;
  failCount: number;
  startedAt: string;
  completedAt?: string;
}

export interface ParsedMergeTag {
  fullMatch: string;
  tagName: string;  // The raw tag name from the document
  inlineTransform: string | null;
}

export interface MergeTagAlias {
  tag_name: string;
  field_key: string;
  tag_type: 'merge_tag' | 'label' | 'f_code';
  replace_next: string | null;
  is_active: boolean;
}

export interface LabelMapping {
  fieldKey: string;
  replaceNext?: string;
}

export interface FieldValueData {
  rawValue: string | number | null;
  dataType: string;
}

export interface DocxProcessingOptions {
  templateName?: string;
}

export interface MergeTagMappings {
  mergeTagMap: Record<string, string>;
  labelMap: Record<string, LabelMapping>;
}

/**
 * Per-lender data object surfaced to the document generator for multi-lender
 * templates. Used to publish indexed `lender_N_*` aliases and `lendersN.*`
 * keys consumed by `{{#each lenders}}` repeater blocks.
 */
export interface LenderData {
  index: number;
  type: string;
  isIndividual: boolean;
  vesting: string;
  firstName: string;
  middle: string;
  last: string;
  displayName: string;
  email: string;
  phone: string;
  label: string;
  isPrimary: boolean;
  contactId: string;
  exists: true;
  [key: string]: any;
}

export interface LenderResolutionResult {
  primaryLender: LenderData | null;
  allLenders: LenderData[];
  additionalLenders: LenderData[];
  lenderCount: number;
  hasMultipleLenders: boolean;
  indexedKeys: Record<string, string>;
}


