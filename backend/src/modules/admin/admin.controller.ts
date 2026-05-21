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
  UpdateProfileDto,
  AssignRoleDto,
  CreateUserFormPermissionDto,
  UpdateUserFormPermissionDto,
} from './dto/admin.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard)
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
    return this.service.listFields({
      sections: sections ? sections.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      ids: ids ? ids.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('fields')
  createField(@Body() dto: CreateFieldDto) {
    return this.service.createField(dto);
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
  updateField(@Param('id') id: string, @Body() dto: UpdateFieldDto) {
    return this.service.updateField(id, dto);
  }

  @Delete('fields/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteField(@Param('id') id: string) {
    return this.service.deleteField(id);
  }

  // ─── Users ───────────────────────────────────────────────────────────────────

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
    const ids = userIds
      ? userIds.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    if (ids?.length) {
      return this.service.listUsersByIds(ids);
    }
    const hasPagination = page != null || limit != null || userType != null || search != null;
    if (!hasPagination) {
      return this.service.listUsers();
    }
    return this.service.listUsersPaginated({
      userType,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      orderBy: orderBy ? { column: orderBy, ascending: ascending === 'true' } : undefined,
    });
  }

  @Get('user-roles')
  listUserRoles(@Query('userIds') userIds?: string) {
    const ids = userIds
      ? userIds.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    if (ids?.length) return this.service.listRolesForUserIds(ids);
    return this.service.listUserRoles();
  }

  @Get('user-permission-levels')
  listUserPermissionLevels() {
    return this.service.findPermissionLevels();
  }

  @Get('csr-users')
  listCsrUsersForPermissions() {
    return this.service.listCsrUsersForPermissions();
  }

  @Get('users/count')
  countProfiles() {
    return this.service.countProfiles();
  }

  @Get('users/:userId/role')
  getUserRole(@Param('userId') userId: string) {
    return this.service.getUserRole(userId);
  }

  @Post('users/:userId/role')
  assignRole(@Param('userId') userId: string, @Body() dto: AssignRoleDto) {
    return this.service.assignRole(userId, dto);
  }

  @Get('users/:userId/profile')
  getProfile(@Param('userId') userId: string) {
    return this.service.getProfile(userId);
  }

  @Patch('users/:userId/profile')
  updateProfile(@Param('userId') userId: string, @Body() dto: UpdateProfileDto) {
    return this.service.updateProfile(userId, dto);
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
  createUserFormPermissions(
    @Param('userId') userId: string,
    @Body() rows: CreateUserFormPermissionDto[],
  ) {
    return this.service.createUserFormPermissions(userId, rows);
  }

  @Patch('users/:userId/form-permissions/:formKey')
  upsertUserFormPermission(
    @Param('userId') userId: string,
    @Param('formKey') formKey: string,
    @Body() dto: UpdateUserFormPermissionDto,
  ) {
    return this.service.upsertUserFormPermission(userId, formKey, dto);
  }

  @Delete('users/:userId/form-permissions')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUserFormPermissions(
    @Param('userId') userId: string,
    @Query('formIds') formIds?: string,
  ) {
    const parsed = formIds ? formIds.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    return this.service.deleteUserFormPermissions(userId, parsed);
  }

  @Patch('form-permissions/:id')
  updateFormPermissionById(
    @Param('id') id: string,
    @Body() dto: UpdateUserFormPermissionDto,
  ) {
    return this.service.updateFormPermissionById(id, dto);
  }
}
