import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const Index: React.FC = () => {
  const { user, loading } = useAuth();

  // While auth resolves, render nothing — the html background (set in
  // index.css) covers the screen so there's no white/spinner flash before
  // redirecting to /dashboard or /auth.
  if (loading) return null;

  return <Navigate to={user ? '/dashboard' : '/auth'} replace />;
};

export default Index;
