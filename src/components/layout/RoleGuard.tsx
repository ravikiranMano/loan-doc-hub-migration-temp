import React from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth, AppRole } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface RoleGuardProps {
  requiredRoles?: AppRole[];
  blockExternalUsers?: boolean;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ requiredRoles, blockExternalUsers = false }) => {
  const { role, loading, isExternalUser } = useAuth();

  // Wait for auth/role to fully resolve before deciding — prevents
  // dashboard-bounce flicker on hard-refresh of guarded routes.
  if (loading || role === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
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
