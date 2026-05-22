import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminRepository } from './admin.repository';
import { toProfileCompat, toUserRoleCompat } from './admin-user.mapper';
import {
  CreateFieldDto,
  UpdateFieldDto,
  UpdateProfileDto,
  AssignRoleDto,
  CreateUserFormPermissionDto,
  UpdateUserFormPermissionDto,
} from './dto/admin.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_CSR_FORM_KEYS = [
  'borrower',
  'co_borrower',
  'property',
  'loan_terms',
  'lender',
  'broker',
  'charges',
  'notes',
  'insurance',
  'liens',
  'origination',
  'trust_ledger',
  'participants',
] as const;

@Injectable()
export class AdminService {
  constructor(private readonly repo: AdminRepository) {}

  // ─── Field Dictionary ────────────────────────────────────────────────────────

  listFields(options?: { sections?: string[]; ids?: string[]; page?: number; limit?: number }) {
    if (options?.ids?.length) return this.lookupFieldsByIds(options.ids);
    if (options?.sections?.length) return this.repo.findFieldsBySections(options.sections);
    return this.repo.findAllFields(options?.page, options?.limit);
  }

  /** Mirrors Supabase `.in('id', ids)` — safe for large id lists (chunked in DB). */
  async lookupFieldsByIds(ids: string[]) {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (!unique.length) return [];

    const CHUNK = 200;
    const rows = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const batch = await this.repo.findFieldsByIds(unique.slice(i, i + CHUNK));
      rows.push(...batch);
    }
    return rows;
  }

  async getField(id: string) {
    const fields = await this.repo.findFieldsByIds([id]);
    const field = fields[0];
    if (!field) throw new NotFoundException(`Field '${id}' not found`);
    return field;
  }

  createField(dto: CreateFieldDto) {
    return this.repo.createField(dto);
  }

  async updateField(id: string, dto: UpdateFieldDto) {
    await this.getField(id);
    return this.repo.updateField(id, dto);
  }

  async deleteField(id: string) {
    await this.getField(id);
    return this.repo.deleteField(id);
  }

  countFields() {
    return this.repo.countFields();
  }

  // ─── Users ───────────────────────────────────────────────────────────────────

  async listUsers() {
    const users = await this.repo.findAllUsers();
    return users.map(toProfileCompat);
  }

  async listUsersByIds(userIds: string[]) {
    const users = await this.repo.findUsersByIds(userIds);
    return users.map(toProfileCompat);
  }

  async listUsersPaginated(options?: {
    userType?: string;
    page?: number;
    limit?: number;
    search?: string;
    orderBy?: { column: string; ascending?: boolean };
  }) {
    const result = await this.repo.findUsersPaginated(options);
    return {
      data: result.data.map(toProfileCompat),
      count: result.count,
    };
  }

  countUsers() {
    return this.repo.countUsers();
  }

  async getUser(id: string) {
    const user = await this.repo.findUserById(id);
    if (!user) throw new NotFoundException(`User '${id}' not found`);
    return user;
  }

  async updateUser(identifier: string, dto: UpdateProfileDto) {
    // Accept either the user UUID directly
    const user = UUID_RE.test(identifier) ? await this.repo.findUserById(identifier) : null;
    if (!user) throw new NotFoundException(`User '${identifier}' not found`);
    return this.repo.updateUser(user.id, dto);
  }

  // ─── Roles ───────────────────────────────────────────────────────────────────

  async getUserRole(userId: string) {
    return this.repo.findUserRole(userId);
  }

  assignRole(userId: string, dto: AssignRoleDto) {
    return this.repo.assignRole(userId, dto.role, dto.permission_level ?? 'full');
  }

  async listUserRoles() {
    const rows = await this.repo.findAllUserRoles();
    return rows.map(toUserRoleCompat);
  }

  findPermissionLevels() {
    return this.repo.findPermissionLevels();
  }

  async listRolesForUserIds(userIds: string[]) {
    const rows = await this.repo.findRolesForUserIds(userIds);
    return rows.map(toUserRoleCompat);
  }

  async listCsrUsersForPermissions() {
    const csrUsers = await this.repo.findCsrUsers();
    if (!csrUsers.length) return [];

    const userIds = csrUsers.map((u) => u.id);
    const permLevels = await this.repo.findPermissionLevelsForUserIds(userIds);
    const permMap = new Map(permLevels.map((p) => [p.user_id, p.permission_level]));

    return csrUsers.map((u) => ({
      user_id: u.id,
      email: u.email,
      full_name: u.full_name,
      permission_level: permMap.get(u.id) ?? 'full',
    }));
  }

  // ─── Field Permissions ───────────────────────────────────────────────────────

  getFieldPermissions(role?: string) {
    return this.repo.findFieldPermissions(role ?? '');
  }

  // ─── Form Permissions ────────────────────────────────────────────────────────

  getFormPermissions(role?: string) {
    if (role) return this.repo.findFormPermissionsByRole(role);
    return this.repo.findAllFormPermissions();
  }

  // ─── User Form Permissions ───────────────────────────────────────────────────

  async getUserFormPermissions(userId: string) {
    const existing = await this.repo.findUserFormPermissions(userId);
    const existingKeys = new Set(existing.map((r) => r.form_key));
    const missing = DEFAULT_CSR_FORM_KEYS.filter((fk) => !existingKeys.has(fk));
    if (missing.length === 0) return existing.sort((a, b) => a.form_key.localeCompare(b.form_key));

    await this.repo.createUserFormPermissions(
      userId,
      missing.map((form_key) => ({ form_key, access_mode: 'view_only' })),
    );
    const rows = await this.repo.findUserFormPermissions(userId);
    return rows.sort((a, b) => a.form_key.localeCompare(b.form_key));
  }

  async createUserFormPermissions(userId: string, rows: CreateUserFormPermissionDto[]) {
    await this.repo.createUserFormPermissions(userId, rows);
    return this.repo.findUserFormPermissions(userId);
  }

  upsertUserFormPermission(userId: string, formKey: string, dto: UpdateUserFormPermissionDto) {
    return this.repo.upsertUserFormPermission(userId, formKey, dto.access_mode);
  }

  deleteUserFormPermissions(userId: string, formIds?: string[]) {
    return this.repo.deleteUserFormPermissions(userId, formIds);
  }

  async updateFormPermissionById(id: string, dto: UpdateUserFormPermissionDto) {
    return this.repo.updateUserFormPermissionById(id, dto);
  }

  listAllUserFormPermissions() {
    return this.repo.findAllUserFormPermissions();
  }
}
