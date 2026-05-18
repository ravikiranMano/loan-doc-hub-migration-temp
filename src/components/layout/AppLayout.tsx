import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSidebar } from '@/contexts/SidebarContext';
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext';
import { ContactWorkspaceProvider, useContactWorkspace } from '@/contexts/ContactWorkspaceContext';
import { FieldDictionaryCacheProvider } from '@/hooks/useFieldDictionaryCache';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { WorkspaceTabBar } from './WorkspaceTabBar';
import { WorkspaceFileRenderer } from '@/components/workspace/WorkspaceFileRenderer';
import { CloseConfirmationDialog } from '@/components/workspace/CloseConfirmationDialog';
import { DealDataEntryInner } from '@/pages/csr/DealDataEntryPage';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const ContentSkeleton = () => (
  <div className="page-container space-y-4 animate-pulse" aria-hidden="true">
    <div className="h-8 w-64 rounded-md bg-muted" />
    <div className="h-4 w-96 max-w-full rounded-md bg-muted" />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
      <div className="h-28 rounded-lg bg-muted" />
      <div className="h-28 rounded-lg bg-muted" />
      <div className="h-28 rounded-lg bg-muted" />
    </div>
    <div className="h-72 rounded-lg bg-muted" />
  </div>
);

const AppLayoutInner: React.FC = () => {
  const { isCollapsed } = useSidebar();
  const { role } = useAuth();
  const { openFiles, activeFileId, closeFile, isFileDirty, setFileDirty } = useWorkspace();
  const contactWs = useContactWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [showRouteSkeleton, setShowRouteSkeleton] = useState(false);
  const hasMountedRef = useRef(false);

  // Close confirmation state (files)
  const [closingFileId, setClosingFileId] = useState<string | null>(null);
  // Close confirmation state (contacts)
  const [closingContactId, setClosingContactId] = useState<string | null>(null);
  // Store save callbacks per file
  const [saveFns, setSaveFns] = useState<Record<string, () => Promise<boolean>>>({});

  const registerSaveFn = useCallback((dealId: string, fn: () => Promise<boolean>) => {
    setSaveFns(prev => ({ ...prev, [dealId]: fn }));
  }, []);

  const unregisterSaveFn = useCallback((dealId: string) => {
    setSaveFns(prev => {
      const next = { ...prev };
      delete next[dealId];
      return next;
    });
  }, []);

  const handleRequestClose = useCallback((fileId: string) => {
    const dirty = isFileDirty(fileId);
    if (dirty) {
      setClosingFileId(fileId);
    } else {
      closeFile(fileId);
      if (activeFileId === fileId) {
        navigate('/deals');
      }
    }
  }, [isFileDirty, closeFile, activeFileId, navigate]);

  const handleSaveAndClose = useCallback(async () => {
    if (!closingFileId) return;
    const saveFn = saveFns[closingFileId];
    if (saveFn) {
      const success = await saveFn();
      if (success) {
        setFileDirty(closingFileId, false);
      }
    }
    const wasActive = activeFileId === closingFileId;
    closeFile(closingFileId);
    setClosingFileId(null);
    if (wasActive) navigate('/deals');
  }, [closingFileId, saveFns, closeFile, activeFileId, navigate, setFileDirty]);

  const handleDiscard = useCallback(() => {
    if (!closingFileId) return;
    const wasActive = activeFileId === closingFileId;
    closeFile(closingFileId);
    setClosingFileId(null);
    if (wasActive) navigate('/deals');
  }, [closingFileId, closeFile, activeFileId, navigate]);

  const handleStay = useCallback(() => {
    setClosingFileId(null);
  }, []);

  // ---- Contact tab close handlers (mirror file behaviour) ----
  const handleRequestCloseContact = useCallback((id: string) => {
    if (contactWs.isContactDirty(id)) {
      setClosingContactId(id);
    } else {
      const closing = contactWs.openContacts.find(c => c.id === id);
      contactWs.closeContact(id);
      // If user is currently viewing this contact, navigate back to its list
      if (closing && location.pathname.startsWith(`/contacts/${closing.kind}s/${id}`)) {
        navigate(`/contacts/${closing.kind}s`);
      }
    }
  }, [contactWs, location.pathname, navigate]);

  const handleContactSaveAndClose = useCallback(async () => {
    if (!closingContactId) return;
    const fn = contactWs.getSaveFn(closingContactId);
    if (fn) {
      const ok = await fn();
      if (ok) contactWs.setContactDirty(closingContactId, false);
    }
    const closing = contactWs.openContacts.find(c => c.id === closingContactId);
    const wasActive = closing && location.pathname.startsWith(`/contacts/${closing.kind}s/${closingContactId}`);
    contactWs.closeContact(closingContactId);
    setClosingContactId(null);
    if (closing && wasActive) navigate(`/contacts/${closing.kind}s`);
  }, [closingContactId, contactWs, location.pathname, navigate]);

  const handleContactDiscard = useCallback(() => {
    if (!closingContactId) return;
    const closing = contactWs.openContacts.find(c => c.id === closingContactId);
    const wasActive = closing && location.pathname.startsWith(`/contacts/${closing.kind}s/${closingContactId}`);
    contactWs.closeContact(closingContactId);
    setClosingContactId(null);
    if (closing && wasActive) navigate(`/contacts/${closing.kind}s`);
  }, [closingContactId, contactWs, location.pathname, navigate]);

  const handleContactStay = useCallback(() => {
    setClosingContactId(null);
  }, []);

  const hasOpenFiles = openFiles.length > 0;

  // Check if the current route is a deal edit route and if the deal is open in workspace
  const dealEditMatch = location.pathname.match(/^\/deals\/([^/]+)\/edit$/);
  const isOnDealsPage = location.pathname === '/deals';
  const isWorkspaceRoute = dealEditMatch && openFiles.find(f => f.id === dealEditMatch[1]);
  // Always show tab bar across the application
  const hasTabBar = role === 'csr';

  const showWorkspaceRenderer = hasOpenFiles;

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    setShowRouteSkeleton(true);
    const timeout = window.setTimeout(() => setShowRouteSkeleton(false), 180);
    return () => {
      window.clearTimeout(timeout);
      return;
    }
  }, [location.pathname, location.search]);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <AppHeader />
      {hasTabBar && (
        <WorkspaceTabBar
          onRequestClose={handleRequestClose}
          onRequestCloseContact={handleRequestCloseContact}
        />
      )}
        <main className={cn(
          "min-h-screen transition-all duration-300",
          isCollapsed ? "pl-16" : "pl-64",
          hasTabBar ? "pt-[88px]" : "pt-12"
        )}>
        <div className="relative min-h-[calc(100vh-88px)]">
          {/* Always render workspace files (hidden when not active) */}
          {showWorkspaceRenderer && (
            <div className={cn(!isWorkspaceRoute && 'app-route-hidden')}>
            <WorkspaceFileRenderer
                renderFile={(dealId, isActive) => (
                  <DealDataEntryInner
                    dealIdProp={dealId}
                    isActiveTab={isActive}
                    registerSaveFn={registerSaveFn}
                    unregisterSaveFn={unregisterSaveFn}
                  />
                )}
              />
            </div>
          )}
          {/* Show Outlet for non-workspace routes */}
          <div className={cn(isWorkspaceRoute && 'app-route-hidden')}>
            <Outlet />
          </div>
          <div
            className={cn(
              'pointer-events-none absolute inset-0 bg-background transition-opacity duration-150 ease-in-out',
              showRouteSkeleton ? 'opacity-100 visible' : 'opacity-0 invisible'
            )}
          >
            <ContentSkeleton />
          </div>
        </div>
      </main>

      <CloseConfirmationDialog
        open={!!closingFileId}
        onSaveAndClose={handleSaveAndClose}
        onDiscard={handleDiscard}
        onStay={handleStay}
      />
      <CloseConfirmationDialog
        open={!!closingContactId}
        onSaveAndClose={handleContactSaveAndClose}
        onDiscard={handleContactDiscard}
        onStay={handleContactStay}
      />
    </div>
  );
};

export const AppLayout: React.FC = () => {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <FieldDictionaryCacheProvider>
      <WorkspaceProvider>
        <ContactWorkspaceProvider>
          <AppLayoutInner />
        </ContactWorkspaceProvider>
      </WorkspaceProvider>
    </FieldDictionaryCacheProvider>
  );
};
