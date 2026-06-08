import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import {
  CreateFieldDto,
  UpdateFieldDto,
  LookupFieldIdsDto,
  LookupFieldKeysDto,
  UpdateProfileDto,
  AssignRoleDto,
  CreateUserFormPermissionDto,
  UpdateUserFormPermissionDto,
} from './dto/admin.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards';
import { Roles } from '../../common/decorators';
import { INTERNAL_STAFF_ROLES, ROLES } from '../../common/constants';
import { parseCommaSeparated, parsePaginationQuery } from '../../common/helpers/query-params';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly service: AdminService) {}

  // ─── Field Dictionary ────────────────────────────────────────────────────────

  // GET /api/admin/fields?sections=a,b&ids=x,y&page=1&limit=50
  @Get('fields')
  listFields(
    @Query('sections') sections?: string,
    @Query('ids') ids?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pagination = parsePaginationQuery(page, limit);
    return this.service.listFields({
      sections: parseCommaSeparated(sections),
      ids: parseCommaSeparated(ids),
      page: pagination.page,
      limit: pagination.limit,
    });
  }

  @Post('fields')
  @Roles(ROLES.ADMIN)
  createField(@Body() dto: CreateFieldDto) {
    return this.service.createField(dto);
  }

  /** POST /api/admin/fields/by-ids — batch lookup (packet required-field resolution). */
  @Post('fields/by-ids')
  @HttpCode(HttpStatus.OK)
  lookupFieldsByIds(@Body() dto: LookupFieldIdsDto) {
    return this.service.lookupFieldsByIds(dto.ids ?? []);
  }

  /** POST /api/admin/fields/by-keys — batch lookup by field_key (deal data save). */
  @Post('fields/by-keys')
  @HttpCode(HttpStatus.OK)
  lookupFieldsByKeys(@Body() dto: LookupFieldKeysDto) {
    return this.service.lookupFieldsByKeys(dto.field_keys ?? []);
  }

  @Get('fields/count')
  countFields() {
    return this.service.countFields();
  }

  @Get('fields/:id')
  getField(@Param('id') id: string) {
    return this.service.getField(id);
  }

  @Patch('fields/:id')
  @Roles(ROLES.ADMIN)
  updateField(@Param('id') id: string, @Body() dto: UpdateFieldDto) {
    return this.service.updateField(id, dto);
  }

  @Delete('fields/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.ADMIN)
  deleteField(@Param('id') id: string) {
    return this.service.deleteField(id);
  }

  // ─── Users ───────────────────────────────────────────────────────────────────

  /** GET /api/admin/users/management-list — User Management page (internal staff). */
  @Get('users/management-list')
  @Roles(ROLES.ADMIN)
  listUsersForManagement() {
    return this.service.listUsersForManagement();
  }

  // GET /api/admin/users?userType=&page=&limit=&search=
  @Get('users')
  listProfiles(
    @Query('userType') userType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('orderBy') orderBy?: string,
    @Query('ascending') ascending?: string,
    @Query('userIds') userIds?: string,
  ) {
    const ids = parseCommaSeparated(userIds);
    if (ids?.length) {
      return this.service.listUsersByIds(ids);
    }
    const hasPagination = page != null || limit != null || userType != null || search != null;
    if (!hasPagination) {
      return this.service.listUsers();
    }
    const pagination = parsePaginationQuery(page, limit);
    return this.service.listUsersPaginated({
      userType,
      page: pagination.page,
      limit: pagination.limit,
      search,
      orderBy: orderBy ? { column: orderBy, ascending: ascending === 'true' } : undefined,
    });
  }

  @Get('user-roles')
  listUserRoles(@Query('userIds') userIds?: string) {
    const ids = parseCommaSeparated(userIds);
    if (ids?.length) return this.service.listRolesForUserIds(ids);
    return this.service.listUserRoles();
  }

  @Get('user-permission-levels')
  listUserPermissionLevels() {
    return this.service.findPermissionLevels();
  }

  @Get('csr-users')
  @Roles(...INTERNAL_STAFF_ROLES)
  listCsrUsersForPermissions() {
    return this.service.listCsrUsersForPermissions();
  }

  @Get('users/count')
  countUsers() {
    return this.service.countUsers();
  }

  @Get('users/:userId/role')
  getUserRole(@Param('userId') userId: string) {
    return this.service.getUserRole(userId);
  }

  @Post('users/:userId/role')
  @Roles(ROLES.ADMIN)
  assignRole(@Param('userId') userId: string, @Body() dto: AssignRoleDto) {
    return this.service.assignRole(userId, dto);
  }

  @Get('users/:userId/profile')
  getProfile(@Param('userId') userId: string) {
    return this.service.getUser(userId);
  }

  @Patch('users/:userId/profile')
  @Roles(ROLES.ADMIN)
  updateProfile(@Param('userId') userId: string, @Body() dto: UpdateProfileDto) {
    return this.service.updateUser(userId, dto);
  }

  // ─── Permissions ─────────────────────────────────────────────────────────────

  @Get('permissions/fields')
  getFieldPermissions(@Query('role') role?: string) {
    return this.service.getFieldPermissions(role);
  }

  @Get('permissions/forms')
  getFormPermissions(@Query('role') role?: string) {
    return this.service.getFormPermissions(role);
  }

  // ─── User Form Permissions ───────────────────────────────────────────────────

  @Get('user-form-permissions')
  listAllUserFormPermissions() {
    return this.service.listAllUserFormPermissions();
  }

  @Get('users/:userId/form-permissions')
  getUserFormPermissions(@Param('userId') userId: string) {
    return this.service.getUserFormPermissions(userId);
  }

  @Post('users/:userId/form-permissions')
  @Roles(ROLES.ADMIN)
  createUserFormPermissions(
    @Param('userId') userId: string,
    @Body() rows: CreateUserFormPermissionDto[],
  ) {
    return this.service.createUserFormPermissions(userId, rows);
  }

  @Patch('users/:userId/form-permissions/:formKey')
  @Roles(ROLES.ADMIN)
  upsertUserFormPermission(
    @Param('userId') userId: string,
    @Param('formKey') formKey: string,
    @Body() dto: UpdateUserFormPermissionDto,
  ) {
    return this.service.upsertUserFormPermission(userId, formKey, dto);
  }

  @Delete('users/:userId/form-permissions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(ROLES.ADMIN)
  deleteUserFormPermissions(
    @Param('userId') userId: string,
    @Query('formIds') formIds?: string,
  ) {
    const parsed = parseCommaSeparated(formIds);
    return this.service.deleteUserFormPermissions(userId, parsed);
  }

  @Patch('form-permissions/:id')
  @Roles(ROLES.ADMIN)
  updateFormPermissionById(
    @Param('id') id: string,
    @Body() dto: UpdateUserFormPermissionDto,
  ) {
    return this.service.updateFormPermissionById(id, dto);
  }
}
