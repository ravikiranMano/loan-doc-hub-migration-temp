/** Tables not yet in generated Database types — use until schema regen. */
export type ConversationLogTypeRow = {
  label: string;
  is_active?: boolean;
  display_order?: number;
};

export type BorrowerAttachmentRow = {
  id: string;
  contact_id: string;
  file_path: string;
  file_name: string;
  status: string;
  uploaded_by?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

export type EventJournalRow = {
  id: string;
  deal_id: string;
  section: string;
  user_id?: string;
  user_name?: string;
  details?: unknown;
  created_at: string;
  ip_address?: string;
  [key: string]: unknown;
};
