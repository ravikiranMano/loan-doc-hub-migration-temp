import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsArray,
} from 'class-validator';

/** DTO for creating a field dictionary entry. */
export class CreateFieldDto {
  @IsString() @IsNotEmpty() field_key: string;
  @IsString() @IsNotEmpty() label: string;
  @IsString() @IsNotEmpty() section: string;
  @IsString() @IsOptional() data_type?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() default_value?: string | null;
  @IsString() @IsOptional() validation_rule?: string | null;
  @IsString() @IsOptional() calculation_formula?: string | null;
  @IsString() @IsOptional() canonical_key?: string | null;
  @IsString() @IsOptional() form_type?: string;
  @IsBoolean() @IsOptional() is_calculated?: boolean;
  @IsBoolean() @IsOptional() is_repeatable?: boolean;
  @IsBoolean() @IsOptional() is_mandatory?: boolean;
  @IsArray() @IsOptional() allowed_roles?: string[];
  @IsArray() @IsOptional() read_only_roles?: string[];
  @IsArray() @IsOptional() calculation_dependencies?: string[];
}

/** DTO for updating a field dictionary entry. */
export class UpdateFieldDto {
  @IsString() @IsOptional() field_key?: string;
  @IsString() @IsOptional() label?: string;
  @IsString() @IsOptional() section?: string;
  @IsString() @IsOptional() data_type?: string;
  @IsString() @IsOptional() description?: string | null;
  @IsString() @IsOptional() default_value?: string | null;
  @IsString() @IsOptional() validation_rule?: string | null;
  @IsString() @IsOptional() calculation_formula?: string | null;
  @IsString() @IsOptional() canonical_key?: string | null;
  @IsString() @IsOptional() form_type?: string;
  @IsBoolean() @IsOptional() is_calculated?: boolean;
  @IsBoolean() @IsOptional() is_repeatable?: boolean;
  @IsBoolean() @IsOptional() is_mandatory?: boolean;
  @IsArray() @IsOptional() allowed_roles?: string[];
  @IsArray() @IsOptional() read_only_roles?: string[];
  @IsArray() @IsOptional() calculation_dependencies?: string[];
}

/** Batch field_dictionary lookup (avoids huge GET ?ids= query strings). */
export class LookupFieldIdsDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

/** Batch field_dictionary lookup by field_key (deal data save fallback). */
export class LookupFieldKeysDto {
  @IsArray()
  @IsString({ each: true })
  field_keys: string[];
}

export class UpdateProfileDto {
  @IsString() @IsOptional() full_name?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() company?: string;
  @IsString() @IsOptional() license_number?: string;
  @IsString() @IsOptional() user_type?: string;
}

export class AssignRoleDto {
  @IsString() @IsNotEmpty() role: string;
  @IsString() @IsOptional() permission_level?: string;
}

export class CreateFormPermissionDto {
  @IsString() @IsNotEmpty() role: string;
  @IsString() @IsNotEmpty() form_key: string;
  @IsString() @IsOptional() access_mode?: string;
  @IsBoolean() @IsOptional() screen_visible?: boolean;
}

export class UpdateFormPermissionDto {
  @IsString() @IsOptional() access_mode?: string;
  @IsBoolean() @IsOptional() screen_visible?: boolean;
  @IsString() @IsOptional() permission_level?: string;
}

export class CreateUserFormPermissionDto {
  @IsString() @IsOptional() user_id?: string;
  @IsString() @IsNotEmpty() form_key: string;
  @IsString() @IsOptional() access_mode?: string;
}

export class UpdateUserFormPermissionDto {
  @IsString() @IsOptional() access_mode?: string;
  @IsString() @IsOptional() updated_at?: string;
}
