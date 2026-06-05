// Domain enum types — source of truth is backend/prisma/schema.prisma
// These replace all Database['public']['Enums']['...'] references in the frontend.

export type AppRole =
  | 'admin'
  | 'csr'
  | 'borrower'
  | 'broker'
  | 'lender'
  | 'other';

export type DealMode = 'doc_prep' | 'servicing_only';

export type DealStatus = 'draft' | 'ready' | 'generated';

export type GenerationStatus = 'queued' | 'running' | 'success' | 'failed';

export type OutputType = 'docx_only' | 'docx_and_pdf';

export type RequestType = 'single_doc' | 'packet';

export type MergeTagType = 'merge_tag' | 'label' | 'f_code';

export type ParticipantAccessMethod = 'login' | 'magic_link';

export type ParticipantStatus = 'invited' | 'in_progress' | 'completed' | 'expired';

export type FieldDataType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'percentage'
  | 'boolean'
  | 'action'
  | 'navigation'
  | 'entity_reference'
  | 'file'
  | 'label'
  | 'datetime'
  | 'date_range'
  | 'search_input'
  | 'sort_control'
  | 'object_reference'
  | 'reference'
  | 'document'
  | 'list'
  | 'dropdown'
  | 'integer'
  | 'phone'
  | 'section'
  | 'template'
  | 'decimal';

export type FieldSection =
  | 'borrower'
  | 'co_borrower'
  | 'loan_terms'
  | 'property'
  | 'seller'
  | 'title'
  | 'escrow'
  | 'other'
  | 'broker'
  | 'system'
  | 'charges'
  | 'dates'
  | 'participants'
  | 'notes'
  | 'lender'
  | 'origination_fees'
  | 'insurance'
  | 'liens'
  | 'charge_adjustment_loan_info'
  | 'charge_adjustment_adjustment_info'
  | 'charge_adjustment_adjustments'
  | 'charge_adjustment_actions'
  | 'charge_history_header'
  | 'charge_history_transaction_grid'
  | 'charge_history_actions'
  | 'loan_charges_summary_header'
  | 'loan_charges_summary_details'
  | 'loan_charges_history_header'
  | 'loan_charges_history_summary'
  | 'loan_charges_history_transactions'
  | 'loan_charges_toolbar'
  | 'properties_main_grid'
  | 'properties_eds'
  | 'customize_grid_config'
  | 'customize_grid_actions'
  | 'new_property_address'
  | 'new_property_appraisal'
  | 'new_property_legal'
  | 'new_property_tabs'
  | 'new_property_actions'
  | 'new_property_dropdowns'
  | 'trust_ledger_tabs'
  | 'trust_ledger_filters'
  | 'trust_ledger_grid'
  | 'trust_ledger_toolbar'
  | 'trust_ledger_data'
  | 'eds_confidential_info'
  | 'eds_messaging'
  | 'eds_notepro_toolbar'
  | 'eds_notepro_borrower_summary'
  | 'eds_notepro_tabs'
  | 'eds_notepro_letter_templates'
  | 'eds_notepro_letter_wizard'
  | 'credit_report_navigation'
  | 'cdfi_navigation'
  | 'event_journal_header'
  | 'event_journal_filters'
  | 'event_journal_columns'
  | 'event_journal_pagination'
  | 'loan_notes_navigation'
  | 'text_messages_navigation'
  | 'conversation_log_table'
  | 'conversation_log_filters'
  | 'conversation_log_toolbar'
  | 'conversation_log_pagination'
  | 'custom_fields_data'
  | 'attachments_grid'
  | 'attachments_filters'
  | 'attachments_toolbar'
  | 'edit_deposit_fields'
  | 'edit_deposit_actions'
  | 'edit_deposit_splits';
