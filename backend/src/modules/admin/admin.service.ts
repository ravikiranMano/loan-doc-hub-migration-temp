import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminRepository } from './admin.repository';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
import {
  CreateFieldDto,
  UpdateFieldDto,
  UpdateProfileDto,
  AssignRoleDto,
  CreateUserFormPermissionDto,
  UpdateUserFormPermissionDto,
} from './dto/admin.dto';

/** Default CSR form keys — kept in sync with frontend FORM_KEYS in useFormPermissions.ts */
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
    if (options?.ids?.length) return this.repo.findFieldsByIds(options.ids);
    if (options?.sections?.length) return this.repo.findFieldsBySections(options.sections);
    return this.repo.findAllFields(options?.page, options?.limit);
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

  // ─── Profiles ────────────────────────────────────────────────────────────────

  async listUsers() {
    const [profiles, roles] = await Promise.all([
      this.repo.findAllProfiles(),
      this.repo.findAllUserRoles(),
    ]);
    const roleMap = new Map(roles.map((r) => [r.user_id, r.role]));
    return profiles.map((p) => ({ ...p, role: roleMap.get(p.user_id) ?? null }));
  }

  async listUsersByIds(userIds: string[]) {
    const profiles = await this.repo.findProfilesByUserIds(userIds);
    return profiles.map((p) => ({
      user_id: p.user_id,
      full_name: p.full_name,
      email: p.email,
    }));
  }

  /** Paginated list — mirrors Supabase profiles.select with count. */
  async listUsersPaginated(options?: {
    userType?: string;
    page?: number;
    limit?: number;
    search?: string;
    orderBy?: { column: string; ascending?: boolean };
  }) {
    const { data, count } = await this.repo.findProfilesPaginated(options);
    return { data, count };
  }

  countProfiles() {
    return this.repo.countProfiles();
  }

  /** Resolve profile by profiles.id (Supabase .eq('id')) or user_id. */
  private async findProfileByIdOrUserId(identifier: string) {
    if (UUID_RE.test(identifier)) {
      const byId = await this.repo.findProfileById(identifier);
      if (byId) return byId;
      const byUserId = await this.repo.findProfileByUserId(identifier);
      if (byUserId) return byUserId;
    }
    return this.repo.findProfileByUserId(identifier);
  }

  async getProfile(identifier: string) {
    const profile = await this.findProfileByIdOrUserId(identifier);
    if (!profile) throw new NotFoundException(`Profile '${identifier}' not found`);
    return profile;
  }

  async updateProfile(identifier: string, dto: UpdateProfileDto) {
    const profile = await this.findProfileByIdOrUserId(identifier);
    if (!profile) throw new NotFoundException(`Profile '${identifier}' not found`);
    return this.repo.updateProfileById(profile.id, dto);
  }

  // ─── User Roles ──────────────────────────────────────────────────────────────

  async getUserRole(userId: string) {
    return this.repo.findUserRole(userId);
  }

  assignRole(userId: string, dto: AssignRoleDto) {
    return this.repo.assignRole(
      userId,
      dto.role,
      dto.permission_level ?? 'full',
    );
  }

  listUserRoles() {
    return this.repo.findAllUserRoles();
  }

  findPermissionLevels() {
    return this.repo.findPermissionLevels();
  }

  listRolesForUserIds(userIds: string[]) {
    return this.repo.findRolesForUserIds(userIds);
  }

  async listCsrUsersForPermissions() {
    const roleRows = await this.repo.findCsrUsersForPermissions();
    if (!roleRows.length) return [];

    const userIds = roleRows.map((r) => r.user_id);
    const [profiles, permLevels] = await Promise.all([
      this.repo.findProfilesByUserIds(userIds),
      this.repo.findPermissionLevelsForUserIds(userIds),
    ]);

    const permMap = new Map(permLevels.map((p) => [p.user_id, p.permission_level]));

    return userIds.map((uid) => {
      const profile = profiles.find((p) => p.user_id === uid);
      return {
        user_id: uid,
        email: profile?.email ?? null,
        full_name: profile?.full_name ?? null,
        permission_level: permMap.get(uid) ?? 'full',
      };
    });
  }

  // ─── Field Permissions ───────────────────────────────────────────────────────

  getFieldPermissions(role?: string) {
    if (role) return this.repo.findFieldPermissions(role);
    return this.repo.findFieldPermissions('');
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
    if (missing.length === 0) {
      return existing.sort((a, b) => a.form_key.localeCompare(b.form_key));
    }
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
