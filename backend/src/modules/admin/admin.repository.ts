import { Injectable } from '@nestjs/common';
import { $Enums } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateFieldDto,
  UpdateFieldDto,
  UpdateProfileDto,
  UpdateUserFormPermissionDto,
} from './dto/admin.dto';

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Field Dictionary ────────────────────────────────────────────────────────

  findAllFields(page?: number, limit?: number, section?: string) {
    const where = section ? { section: section as $Enums.field_section } : undefined;
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit ?? undefined;
    return this.prisma.field_dictionary.findMany({
      where,
      skip,
      take,
      orderBy: [{ section: 'asc' }, { label: 'asc' }],
    });
  }

  findFieldsByIds(ids: string[]) {
    return this.prisma.field_dictionary.findMany({ where: { id: { in: ids } } });
  }

  findFieldsBySections(sections: string[]) {
    return this.prisma.field_dictionary.findMany({
      where: { section: { in: sections as $Enums.field_section[] } },
      orderBy: [{ section: 'asc' }, { label: 'asc' }],
    });
  }

  countFields() {
    return this.prisma.field_dictionary.count();
  }

  createField(dto: CreateFieldDto) {
    return this.prisma.field_dictionary.create({ data: dto as any });
  }

  updateField(id: string, dto: UpdateFieldDto) {
    return this.prisma.field_dictionary.update({
      where: { id },
      data: { ...dto, updated_at: new Date() } as any,
    });
  }

  deleteField(id: string) {
    return this.prisma.field_dictionary.delete({ where: { id } });
  }

  // ─── Profiles ────────────────────────────────────────────────────────────────

  findAllProfiles() {
    return this.prisma.profiles.findMany({ orderBy: { email: 'asc' } });
  }

  async findProfilesPaginated(options?: {
    userType?: string;
    page?: number;
    limit?: number;
    search?: string;
    orderBy?: { column: string; ascending?: boolean };
  }) {
    const where: Record<string, unknown> = {};
    if (options?.userType) {
      where['user_type'] = options.userType;
    }
    if (options?.search?.trim()) {
      const s = options.search.trim();
      where['OR'] = [
        { full_name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { company: { contains: s, mode: 'insensitive' } },
      ];
    }

    const orderColumn = options?.orderBy?.column ?? 'created_at';
    const orderDir = options?.orderBy?.ascending ? 'asc' : 'desc';
    const skip =
      options?.page != null && options?.limit != null
        ? (options.page - 1) * options.limit
        : undefined;
    const take = options?.limit ?? undefined;

    const [data, count] = await Promise.all([
      this.prisma.profiles.findMany({
        where,
        skip,
        take,
        orderBy: { [orderColumn]: orderDir },
      }),
      this.prisma.profiles.count({ where }),
    ]);

    return { data, count };
  }

  countProfiles() {
    return this.prisma.profiles.count();
  }

  findProfileById(id: string) {
    return this.prisma.profiles.findUnique({ where: { id } });
  }

  findProfileByUserId(userId: string) {
    return this.prisma.profiles.findUnique({ where: { user_id: userId } });
  }

  updateProfileById(id: string, dto: UpdateProfileDto) {
    return this.prisma.profiles.update({
      where: { id },
      data: { ...dto, updated_at: new Date() },
    });
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.profiles.update({
      where: { user_id: userId },
      data: { ...dto, updated_at: new Date() },
    });
  }

  // ─── User Roles ──────────────────────────────────────────────────────────────

  findUserRole(userId: string) {
    return this.prisma.user_roles.findFirst({ where: { user_id: userId } });
  }

  findRolesForUserIds(ids: string[]) {
    return this.prisma.user_roles.findMany({ where: { user_id: { in: ids } } });
  }

  findAllUserRoles() {
    return this.prisma.user_roles.findMany();
  }

  findPermissionLevels() {
    return this.prisma.user_permission_levels.findMany();
  }

  /**
   * Mirrors Supabase RPC assign_user_role_and_permission:
   * delete existing roles, insert one role, upsert/delete permission level for CSR.
   */
  async assignRole(userId: string, role: string, permissionLevel = 'full') {
    const appRole = role as $Enums.app_role;

    return this.prisma.$transaction(async (tx) => {
      await tx.user_roles.deleteMany({ where: { user_id: userId } });

      const userRole = await tx.user_roles.create({
        data: { user_id: userId, role: appRole },
      });

      if (appRole === 'csr') {
        await tx.user_permission_levels.upsert({
          where: { user_id: userId },
          create: {
            user_id: userId,
            permission_level: permissionLevel ?? 'full',
          },
          update: {
            permission_level: permissionLevel ?? 'full',
            updated_at: new Date(),
          },
        });
      } else {
        await tx.user_permission_levels.deleteMany({ where: { user_id: userId } });
      }

      return userRole;
    });
  }

  findCsrUsersForPermissions() {
    return this.prisma.user_roles.findMany({
      where: { role: 'csr' },
      select: { user_id: true },
    });
  }

  findProfilesByUserIds(userIds: string[]) {
    return this.prisma.profiles.findMany({
      where: { user_id: { in: userIds } },
      select: { user_id: true, email: true, full_name: true },
    });
  }

  findPermissionLevelsForUserIds(userIds: string[]) {
    return this.prisma.user_permission_levels.findMany({
      where: { user_id: { in: userIds } },
      select: { user_id: true, permission_level: true },
    });
  }

  // ─── Field Permissions ───────────────────────────────────────────────────────

  findFieldPermissions(role: string) {
    return this.prisma.field_permissions.findMany({ where: { role: role as $Enums.app_role } });
  }

  // ─── Form Permissions ────────────────────────────────────────────────────────

  findAllFormPermissions() {
    return this.prisma.form_permissions.findMany();
  }

  findFormPermissionsByRole(role: string) {
    return this.prisma.form_permissions.findMany({ where: { role: role as $Enums.app_role } });
  }

  // ─── User Form Permissions ───────────────────────────────────────────────────

  findUserFormPermissions(userId: string) {
    return this.prisma.user_form_permissions.findMany({ where: { user_id: userId } });
  }

  findAllUserFormPermissions() {
    return this.prisma.user_form_permissions.findMany();
  }

  createUserFormPermissions(userId: string, rows: { form_key: string; access_mode?: string }[]) {
    return this.prisma.user_form_permissions.createMany({
      data: rows.map((r) => ({ user_id: userId, form_key: r.form_key, access_mode: r.access_mode })),
      skipDuplicates: true,
    });
  }

  upsertUserFormPermission(userId: string, formKey: string, accessMode?: string) {
    return this.prisma.user_form_permissions.upsert({
      where: { user_id_form_key: { user_id: userId, form_key: formKey } },
      create: { user_id: userId, form_key: formKey, access_mode: accessMode },
      update: { access_mode: accessMode, updated_at: new Date() },
    });
  }

  deleteUserFormPermissions(userId: string, formIds?: string[]) {
    return this.prisma.user_form_permissions.deleteMany({
      where: {
        user_id: userId,
        ...(formIds?.length ? { form_key: { in: formIds } } : {}),
      },
    });
  }

  updateUserFormPermissionById(id: string, dto: UpdateUserFormPermissionDto) {
    const { access_mode } = dto;
    return this.prisma.user_form_permissions.update({
      where: { id },
      data: {
        ...(access_mode !== undefined && { access_mode }),
        updated_at: new Date(),
      },
    });
  }
}
