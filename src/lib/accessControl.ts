import { AppRole, EXTERNAL_ROLES, INTERNAL_ROLES } from '@/contexts/AuthContext';
import {
  fetchFieldVisibility as fetchFieldVisibilityFromService,
  fetchFieldPermissions as fetchFieldPermissionsFromService,
  type FieldPermission,
  type FieldVisibility,
} from '@/services/admin/field-permissions.service';
import {
  fetchUserDealAssignments,
  fetchDealAssignments,
  assignUserToDeal,
  removeUserFromDeal,
  type DealAssignment,
} from '@/services/deals/deal-assignments.service';

export type { FieldPermission, DealAssignment, FieldVisibility };

/**
 * Check if a role is an external role (borrower, broker, lender)
 */
export const isExternalRole = (role: AppRole): boolean => {
  return role !== null && EXTERNAL_ROLES.includes(role);
};

/**
 * Check if a role is an internal role (admin, csr)
 */
export const isInternalRole = (role: AppRole): boolean => {
  return role !== null && INTERNAL_ROLES.includes(role);
};

/**
 * Check if a role has admin-level access
 */
export const hasAdminAccess = (role: AppRole): boolean => {
  return role === 'admin';
};

/**
 * Check if a role can create deals
 */
export const canCreateDeal = (role: AppRole): boolean => {
  return role === 'csr' || role === 'admin';
};

/**
 * Check if a role can generate documents
 */
export const canGenerateDocuments = (role: AppRole): boolean => {
  return role === 'csr' || role === 'admin';
};

/**
 * Check if a role can access admin screens
 */
export const canAccessAdminScreens = (role: AppRole): boolean => {
  return role === 'admin';
};

export const fetchFieldVisibility = fetchFieldVisibilityFromService;

export const fetchFieldPermissions = async (role: AppRole): Promise<Map<string, FieldPermission>> => {
  if (!role || isInternalRole(role)) {
    return new Map();
  }
  return fetchFieldPermissionsFromService(role);
};

/**
 * Check if user can view a specific field using field_dictionary visibility
 */
export const canViewFieldWithVisibility = (
  role: AppRole,
  fieldKey: string,
  fieldVisibility: Map<string, FieldVisibility>
): boolean => {
  // Internal users have full access
  if (isInternalRole(role)) {
    return true;
  }

  // External users need to be in allowed_roles or read_only_roles
  const visibility = fieldVisibility.get(fieldKey);
  if (!visibility) return false;
  
  return visibility.allowed_roles.includes(role!) || visibility.read_only_roles.includes(role!);
};

/**
 * Check if user can edit a specific field using field_dictionary visibility
 */
export const canEditFieldWithVisibility = (
  role: AppRole,
  fieldKey: string,
  fieldVisibility: Map<string, FieldVisibility>
): boolean => {
  // Admin can view all but not edit deal data (only config)
  if (role === 'admin') {
    return false; // Admin can only view, edit is handled at config level
  }
  
  // CSR can edit all non-calculated fields
  if (role === 'csr') {
    const visibility = fieldVisibility.get(fieldKey);
    return visibility ? !visibility.is_calculated : true;
  }

  // External users need to be in allowed_roles (not read_only_roles)
  const visibility = fieldVisibility.get(fieldKey);
  if (!visibility) return false;
  
  // Cannot edit calculated fields
  if (visibility.is_calculated) return false;
  
  return visibility.allowed_roles.includes(role!);
};

/**
 * Check if user can view a specific field (legacy - uses field_permissions)
 */
export const canViewField = (
  role: AppRole,
  fieldKey: string,
  fieldPermissions: Map<string, FieldPermission>
): boolean => {
  // Internal users have full access
  if (isInternalRole(role)) {
    return true;
  }

  // External users need explicit permission
  const permission = fieldPermissions.get(fieldKey);
  return permission?.can_view ?? false;
};

/**
 * Check if user can edit a specific field (legacy - uses field_permissions)
 */
export const canEditField = (
  role: AppRole,
  fieldKey: string,
  fieldPermissions: Map<string, FieldPermission>
): boolean => {
  // Internal users have full access
  if (isInternalRole(role)) {
    return true;
  }

  // External users need explicit permission
  const permission = fieldPermissions.get(fieldKey);
  return permission?.can_edit ?? false;
};

export {
  fetchUserDealAssignments,
  fetchDealAssignments,
  assignUserToDeal,
  removeUserFromDeal,
};

/**
 * Filter fields based on user's permissions
 */
export const filterFieldsByPermission = <T extends { field_key: string }>(
  fields: T[],
  role: AppRole,
  fieldPermissions: Map<string, FieldPermission>,
  checkEdit: boolean = false
): T[] => {
  // Internal users see all fields
  if (isInternalRole(role)) {
    return fields;
  }

  // External users only see permitted fields
  return fields.filter(field => {
    const permission = fieldPermissions.get(field.field_key);
    return checkEdit ? permission?.can_edit : permission?.can_view;
  });
};

/**
 * Get role display name
 */
export const getRoleDisplayName = (role: AppRole): string => {
  switch (role) {
    case 'admin':
      return 'Administrator';
    case 'csr':
      return 'CSR';
    case 'borrower':
      return 'Borrower';
    case 'broker':
      return 'Broker';
    case 'lender':
      return 'Lender';
    case 'other':
      return 'Other';
    default:
      return 'Unknown';
  }
};

/**
 * Get role badge color classes
 */
export const getRoleBadgeClasses = (role: AppRole): string => {
  switch (role) {
    case 'admin':
      return 'bg-destructive/10 text-destructive';
    case 'csr':
      return 'bg-primary/10 text-primary';
    case 'borrower':
      return 'bg-success/10 text-success';
    case 'broker':
      return 'bg-warning/10 text-warning';
    case 'lender':
      return 'bg-accent/10 text-accent-foreground';
    case 'other':
      return 'bg-muted text-muted-foreground';
    default:
      return 'bg-muted text-muted-foreground';
  }
};
