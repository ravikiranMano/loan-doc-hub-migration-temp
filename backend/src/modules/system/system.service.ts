import { Injectable, NotFoundException } from '@nestjs/common';
import { SystemRepository } from './system.repository';
import { CreateSettingDto, UpdateSettingDto } from './dto/system-setting.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SystemService {
  constructor(private readonly repo: SystemRepository) {}

  listSettings(keys?: string[]) {
    if (keys?.length) return this.repo.findByKeys(keys);
    return this.repo.findAll();
  }

  /** Resolve by UUID id (Supabase path) or setting_key. */
  private async findByIdOrKey(identifier: string) {
    if (UUID_RE.test(identifier)) {
      const byId = await this.repo.findById(identifier);
      if (byId) return byId;
    }
    return this.repo.findByKey(identifier);
  }

  async getSetting(identifier: string) {
    const setting = await this.findByIdOrKey(identifier);
    if (!setting) throw new NotFoundException(`Setting '${identifier}' not found`);
    return setting;
  }

  createSetting(dto: CreateSettingDto) {
    return this.repo.create(dto);
  }

  async updateSetting(identifier: string, dto: UpdateSettingDto) {
    const setting = await this.findByIdOrKey(identifier);
    if (!setting) throw new NotFoundException(`Setting '${identifier}' not found`);
    return this.repo.updateById(setting.id, dto);
  }

  async deleteSetting(identifier: string) {
    const setting = await this.findByIdOrKey(identifier);
    if (!setting) throw new NotFoundException(`Setting '${identifier}' not found`);
    return this.repo.deleteById(setting.id);
  }
}
