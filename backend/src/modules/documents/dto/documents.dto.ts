import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsIn } from 'class-validator';

export class CreateTemplateDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsOptional() state?: string;
  @IsString() @IsOptional() product_type?: string;
  @IsNumber() @IsOptional() version?: number;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() file_path?: string;
  @IsString() @IsOptional() reference_pdf_path?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
}

export class UpdateTemplateDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() state?: string;
  @IsString() @IsOptional() product_type?: string;
  @IsNumber() @IsOptional() version?: number;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() file_path?: string;
  @IsString() @IsOptional() reference_pdf_path?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
}

export class CreatePacketDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() state: string;
  @IsString() @IsNotEmpty() product_type: string;
  @IsString() @IsOptional() description?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
  @IsBoolean() @IsOptional() all_states?: boolean;
  @IsOptional() states?: string[];
}

export class UpdatePacketDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() state?: string;
  @IsString() @IsOptional() product_type?: string;
  @IsString() @IsOptional() description?: string;
  @IsBoolean() @IsOptional() is_active?: boolean;
  @IsBoolean() @IsOptional() all_states?: boolean;
  @IsOptional() states?: string[];
}

/** Mirrors Supabase packet_templates Insert (packet_id also set from URL param). */
export class CreatePacketTemplateDto {
  @IsString() @IsOptional() packet_id?: string;
  @IsString() @IsNotEmpty() template_id: string;
  @IsNumber() @IsOptional() display_order?: number;
  @IsBoolean() @IsOptional() is_required?: boolean;
}

/** Mirrors Supabase template_field_maps Insert (template_id also set from URL param). */
export class CreateTemplateFieldMapDto {
  @IsString() @IsOptional() template_id?: string;
  @IsString() @IsOptional() field_dictionary_id?: string | null;
  @IsBoolean() @IsOptional() required_flag?: boolean;
  @IsString() @IsOptional() transform_rule?: string | null;
  @IsNumber() @IsOptional() display_order?: number | null;
}

/** Mirrors Supabase template_field_maps Update. */
export class UpdateTemplateFieldMapDto {
  @IsString() @IsOptional() template_id?: string;
  @IsString() @IsOptional() field_dictionary_id?: string | null;
  @IsBoolean() @IsOptional() required_flag?: boolean;
  @IsString() @IsOptional() transform_rule?: string | null;
  @IsNumber() @IsOptional() display_order?: number | null;
}

export class CreateMergeTagDto {
  @IsString() @IsNotEmpty() tag_name: string;
  @IsString() @IsNotEmpty() field_key: string;
  @IsString() @IsOptional() tag_type?: string;
  @IsBoolean() @IsOptional() replace_next?: boolean;
  @IsBoolean() @IsOptional() is_active?: boolean;
  @IsString() @IsOptional() description?: string;
}

export class UpdateMergeTagDto {
  @IsString() @IsOptional() tag_name?: string;
  @IsString() @IsOptional() field_key?: string;
  @IsString() @IsOptional() tag_type?: string;
  @IsBoolean() @IsOptional() replace_next?: boolean;
  @IsBoolean() @IsOptional() is_active?: boolean;
  @IsString() @IsOptional() description?: string;
}

export class GenerateDocumentDto {
  @IsString() @IsOptional() packet_id?: string;
  @IsString() @IsOptional() template_id?: string;
  @IsString() @IsOptional() output_type?: string;
  @IsString() @IsNotEmpty() @IsIn(['single_doc', 'packet']) request_type: string;
}
