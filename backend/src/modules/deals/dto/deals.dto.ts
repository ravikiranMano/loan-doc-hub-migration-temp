import { IsString, IsNotEmpty, IsOptional, IsNumber, IsObject, IsUUID } from 'class-validator';

export class CreateDealDto {
  @IsString() @IsNotEmpty() deal_number: string;
  @IsString() @IsOptional() state?: string;
  @IsString() @IsOptional() product_type?: string;
  @IsString() @IsOptional() packet_id?: string;
  @IsString() @IsOptional() mode?: string;
  @IsString() @IsOptional() status?: string;
  @IsString() @IsOptional() borrower_name?: string;
  @IsString() @IsOptional() property_address?: string;
  @IsNumber() @IsOptional() loan_amount?: number;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() created_by?: string;
}

export class UpdateDealDto {
  @IsString() @IsOptional() deal_number?: string;
  @IsString() @IsOptional() state?: string;
  @IsString() @IsOptional() product_type?: string;
  @IsString() @IsOptional() packet_id?: string;
  @IsString() @IsOptional() mode?: string;
  @IsString() @IsOptional() status?: string;
  @IsString() @IsOptional() borrower_name?: string;
  @IsString() @IsOptional() property_address?: string;
  @IsNumber() @IsOptional() loan_amount?: number;
  @IsString() @IsOptional() notes?: string;
}

export class CreateParticipantDto {
  @IsString() @IsNotEmpty() role: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() contact_id?: string;
  @IsString() @IsOptional() user_id?: string;
  @IsString() @IsOptional() access_method?: string;
  @IsNumber() @IsOptional() sequence_order?: number;
  @IsString() @IsOptional() status?: string;
}

export class UpdateParticipantDto {
  @IsString() @IsOptional() role?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() contact_id?: string;
  @IsString() @IsOptional() user_id?: string;
  @IsString() @IsOptional() access_method?: string;
  @IsNumber() @IsOptional() sequence_order?: number;
  @IsString() @IsOptional() status?: string;
}

export class UpsertSectionDto {
  @IsOptional() field_values: Record<string, unknown>;
}

export class CreateLoanHistoryDto {
  @IsString() @IsOptional() date_received?: string;
  @IsString() @IsOptional() date_due?: string;
  @IsString() @IsOptional() reference?: string;
  @IsString() @IsOptional() payment_code?: string;
  @IsNumber() @IsOptional() total_amount_received?: number;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() account_number?: string;
  @IsString() @IsOptional() next_due_date?: string;
  @IsNumber() @IsOptional() principal_balance?: number;
}

export class UpdateLoanHistoryDto {
  @IsString() @IsOptional() date_received?: string;
  @IsString() @IsOptional() date_due?: string;
  @IsString() @IsOptional() reference?: string;
  @IsString() @IsOptional() payment_code?: string;
  @IsNumber() @IsOptional() total_amount_received?: number;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() account_number?: string;
  @IsString() @IsOptional() next_due_date?: string;
  @IsNumber() @IsOptional() principal_balance?: number;
}

export class CreateAssignmentDto {
  @IsString() @IsNotEmpty() user_id: string;
  @IsString() @IsNotEmpty() role: string;
  @IsString() @IsOptional() notes?: string;
}

export class CreateActivityLogDto {
  @IsUUID() @IsNotEmpty() actor_user_id: string;
  @IsString() @IsNotEmpty() action_type: string;
  @IsObject() @IsOptional() action_details?: Record<string, unknown>;
}
