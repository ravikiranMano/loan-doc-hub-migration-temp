import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth, AppRole } from '@/contexts/AuthContext';

interface RoleGuardProps {
  requiredRoles?: AppRole[];
  blockExternalUsers?: boolean;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ requiredRoles, blockExternalUsers = false }) => {
  const { role, loading, isExternalUser } = useAuth();

  // While auth/role is resolving, render nothing so the previous route stays
  // painted until the new route is ready. Prevents a spinner flash on every
  // guarded navigation.
  if (loading || role === null) {
    return null;
  }

  if (blockExternalUsers && isExternalUser) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requiredRoles && requiredRoles.length > 0) {
    const hasRequiredRole = role && requiredRoles.includes(role);
    if (!hasRequiredRole) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <Outlet />;
};
