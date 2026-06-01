import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth, AppRole } from '@/contexts/AuthContext';

interface RoleGuardProps {
  requiredRoles?: AppRole[];
  blockExternalUsers?: boolean;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ requiredRoles, blockExternalUsers = false }) => {
  const { role, loading, isExternalUser } = useAuth();

  // While auth/role is resolving, render the Outlet so the previously
  // painted route content stays on screen. The redirect (if any) fires a
  // frame later once role resolves — no visible blank flash.
  if (loading || role === null) {
    return <Outlet />;
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
