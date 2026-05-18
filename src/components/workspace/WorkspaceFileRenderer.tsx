import React from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { DealNavigationProvider } from '@/contexts/DealNavigationContext';
import { cn } from '@/lib/utils';

// We dynamically import the inner component to avoid circular deps
// The DealDataEntryInner is not exported, so we use the full page which wraps with DealNavigationProvider
// Instead, we create a lightweight wrapper that renders DealDataEntryPage content per file

interface WorkspaceFileRendererProps {
  renderFile: (dealId: string, isActive: boolean) => React.ReactNode;
}

export const WorkspaceFileRenderer: React.FC<WorkspaceFileRendererProps> = ({ renderFile }) => {
  const { openFiles, activeFileId } = useWorkspace();

  return (
    <>
      {openFiles.map(file => {
        const isActive = activeFileId === file.id;
        return (
          <div
            key={file.id}
            className={cn(
              'app-keepalive-pane',
              isActive ? 'app-keepalive-pane-active' : 'app-keepalive-pane-inactive'
            )}
            aria-hidden={!isActive}
          >
            <DealNavigationProvider dealId={file.id} initialTab="loan_terms">
              {renderFile(file.id, isActive)}
            </DealNavigationProvider>
          </div>
        );
      })}
    </>
  );
};
