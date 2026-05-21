import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSettingDto, UpdateSettingDto } from './dto/system-setting.dto';

@Injectable()
export class SystemRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.system_settings.findMany({
      orderBy: { setting_key: 'asc' },
    });
  }

  findByKeys(keys: string[]) {
    return this.prisma.system_settings.findMany({
      where: { setting_key: { in: keys } },
    });
  }

  findById(id: string) {
    return this.prisma.system_settings.findUnique({ where: { id } });
  }

  findByKey(key: string) {
    return this.prisma.system_settings.findUnique({
      where: { setting_key: key },
    });
  }

  create(dto: CreateSettingDto) {
    return this.prisma.system_settings.create({ data: dto });
  }

  updateById(id: string, dto: UpdateSettingDto) {
    return this.prisma.system_settings.update({
      where: { id },
      data: { ...dto, updated_at: new Date() },
    });
  }

  updateByKey(key: string, dto: UpdateSettingDto) {
    return this.prisma.system_settings.update({
      where: { setting_key: key },
      data: { ...dto, updated_at: new Date() },
    });
  }

  deleteById(id: string) {
    return this.prisma.system_settings.delete({ where: { id } });
  }

  deleteByKey(key: string) {
    return this.prisma.system_settings.delete({
      where: { setting_key: key },
    });
  }
}
