import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { SystemService } from './system.service';
import { CreateSettingDto, UpdateSettingDto } from './dto/system-setting.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('system/settings')
@UseGuards(JwtAuthGuard)
export class SystemController {
  constructor(private readonly service: SystemService) {}

  // GET /api/system/settings
  // GET /api/system/settings?keys=key1,key2
  @Get()
  list(@Query('keys') keys?: string) {
    const parsed = keys ? keys.split(',').map((k) => k.trim()).filter(Boolean) : undefined;
    return this.service.listSettings(parsed);
  }

  // GET /api/system/settings/:key
  @Get(':key')
  getOne(@Param('key') key: string) {
    return this.service.getSetting(key);
  }

  // POST /api/system/settings
  @Post()
  create(@Body() dto: CreateSettingDto) {
    return this.service.createSetting(dto);
  }

  // PATCH /api/system/settings/:key
  @Patch(':key')
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto) {
    return this.service.updateSetting(key, dto);
  }

  // DELETE /api/system/settings/:key
  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('key') key: string) {
    return this.service.deleteSetting(key);
  }
}
