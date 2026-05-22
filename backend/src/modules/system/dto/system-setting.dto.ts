import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateSettingDto {
  @IsString() @IsNotEmpty() setting_key: string;
  @IsString() @IsOptional() setting_value?: string;
  @IsString() @IsOptional() setting_type?: string;
  @IsString() @IsOptional() description?: string;
}

export class UpdateSettingDto {
  @IsString() @IsOptional() setting_value?: string;
  @IsString() @IsOptional() setting_type?: string;
  @IsString() @IsOptional() description?: string;
}
