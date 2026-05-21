import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

export class CreateContactDto {
  @IsString() @IsNotEmpty() contact_type: string;
  @IsString() @IsOptional() first_name?: string;
  @IsString() @IsOptional() last_name?: string;
  @IsString() @IsOptional() full_name?: string;
  @IsString() @IsOptional() company?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() state?: string;
  @IsOptional() contact_data?: Record<string, unknown>;
  @IsString() @IsOptional() contact_id?: string;
  @IsString() @IsOptional() created_by?: string;
}

export class UpdateContactDto {
  @IsString() @IsOptional() contact_type?: string;
  @IsString() @IsOptional() first_name?: string;
  @IsString() @IsOptional() last_name?: string;
  @IsString() @IsOptional() full_name?: string;
  @IsString() @IsOptional() company?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() state?: string;
  @IsOptional() contact_data?: Record<string, unknown>;
}

export class CreateAttachmentDto {
  @IsString() @IsNotEmpty() file_name: string;
  @IsString() @IsNotEmpty() file_path: string;
  @IsString() @IsOptional() file_type?: string;
  @IsNumber() @IsOptional() file_size?: number;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() description?: string;
}

export class UpdateAttachmentDto {
  @IsString() @IsOptional() file_name?: string;
  @IsString() @IsOptional() file_path?: string;
  @IsString() @IsOptional() file_type?: string;
  @IsNumber() @IsOptional() file_size?: number;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() status?: string;
}
