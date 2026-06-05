/** Maps Prisma template_field_maps rows to the API response shape. */
export function toTemplateFieldMapCompat(row: {
  id: string;
  template_id: string;
  field_dictionary_id: string | null;
  required_flag: boolean;
  transform_rule: string | null;
  display_order: number | null;
  created_at: Date | string;
  field_dictionary?: {
    id: string;
    field_key: string;
    label: string;
    section: string;
    data_type: string;
    description?: string | null;
  } | null;
}) {
  return {
    id: row.id,
    template_id: row.template_id,
    field_dictionary_id: row.field_dictionary_id,
    required_flag: row.required_flag,
    transform_rule: row.transform_rule,
    display_order: row.display_order ?? 0,
    created_at: row.created_at,
    field_dictionary: row.field_dictionary ?? null,
  };
}
