/**
 * Entry Orchestration Hook
 * 
 * Manages parallel/sequential entry modes for deal participants.
 * - Parallel: All participants can edit their allowed fields anytime
 * - Sequential: Only participant with lowest incomplete sequence can edit
 * 
 * Optimized: Internal users (CSR/admin) skip all DB queries and realtime subscriptions.
 */

import { useState, useEffect, useCallback } from 'react';
import { listParticipantsByDealOrdered } from '@/services/deals/participants.service';
import { subscribeToChanges } from '@/services/node-api/realtime';
import { invokeCompleteParticipantSection } from '@/services/supabase/functions';
import { apiClient, isNodeApiEnabled } from '@/services/node-api/client';
import { useAuth } from '@/contexts/AuthContext';
import { getMagicLinkSession } from '@/lib/magicLink';
import type { Database } from '@/integrations/supabase/types';

type ParticipantStatus = Database['public']['Enums']['participant_status'];

export interface DealParticipant {
  id: string;
  deal_id: string;
  role: string;
  user_id: string | null;
  access_method: 'login' | 'magic_link';
  sequence_order: number | null;
  status: ParticipantStatus;
  invited_at: string;
  completed_at: string | null;
}

export interface OrchestrationState {
  mode: 'parallel' | 'sequential';
  canEdit: boolean;
  isWaiting: boolean;
  currentParticipant: DealParticipant | null;
  allParticipants: DealParticipant[];
  blockingParticipant: DealParticipant | null;
  hasCompleted: boolean;
  loading: boolean;
}

export interface UseEntryOrchestrationResult extends OrchestrationState {
  completeSection: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

function determineMode(participants: DealParticipant[]): 'parallel' | 'sequential' {
  return participants.some(p => p.sequence_order !== null) ? 'sequential' : 'parallel';
}

function findActiveParticipant(participants: DealParticipant[]): DealParticipant | null {
  const incompleteSequential = participants
    .filter(p => p.sequence_order !== null && p.status !== 'completed')
    .sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));
  
  return incompleteSequential[0] || null;
}

function findBlockingParticipant(
  currentParticipant: DealParticipant,
  participants: DealParticipant[]
): DealParticipant | null {
  if (currentParticipant.sequence_order === null) return null;
  
  const blocking = participants
    .filter(p => 
      p.sequence_order !== null &&
      p.sequence_order < currentParticipant.sequence_order! &&
      p.status !== 'completed'
    )
    .sort((a, b) => (b.sequence_order || 0) - (a.sequence_order || 0));
  
  return blocking[0] || null;
}

// Default state for internal users - skip all DB work
const INTERNAL_USER_DEFAULT: OrchestrationState = {
  mode: 'parallel',
  canEdit: true,
  isWaiting: false,
  currentParticipant: null,
  allParticipants: [],
  blockingParticipant: null,
  hasCompleted: false,
  loading: false,
};

export function useEntryOrchestration(dealId: string): UseEntryOrchestrationResult {
  const { user, role, isExternalUser, isInternalUser } = useAuth();
  const [state, setState] = useState<OrchestrationState>(
    isInternalUser ? INTERNAL_USER_DEFAULT : {
      mode: 'parallel',
      canEdit: true,
      isWaiting: false,
      currentParticipant: null,
      allParticipants: [],
      blockingParticipant: null,
      hasCompleted: false,
      loading: true,
    }
  );

  // Early return for internal users - no DB queries, no realtime
  const noopRefresh = useCallback(async () => {}, []);
  const noopComplete = useCallback(async () => false, []);

  const fetchParticipants = useCallback(async () => {
    if (!dealId || isInternalUser) {
      setState(prev => ({ ...prev, loading: false }));
      return;
    }

    try {
      const participants = await listParticipantsByDealOrdered(dealId);
      const allParticipants = (participants || []) as DealParticipant[];
      const mode = determineMode(allParticipants);

      let currentParticipant: DealParticipant | null = null;
      
      if (user) {
        currentParticipant = allParticipants.find(p => p.user_id === user.id) || null;
      }
      
      if (!currentParticipant && isExternalUser) {
        const session = getMagicLinkSession();
        if (session?.participantId) {
          currentParticipant = allParticipants.find(p => p.id === session.participantId) || null;
        }
      }

      let canEdit = true;
      let isWaiting = false;
      let blockingParticipant: DealParticipant | null = null;

      if (isExternalUser && currentParticipant) {
        if (currentParticipant.status === 'completed') {
          canEdit = false;
        } else if (mode === 'sequential') {
          const activeParticipant = findActiveParticipant(allParticipants);
          
          if (activeParticipant && activeParticipant.id !== currentParticipant.id) {
            canEdit = false;
            isWaiting = true;
            blockingParticipant = findBlockingParticipant(currentParticipant, allParticipants);
          }
        }
      } else if (!isExternalUser) {
        canEdit = true;
      }

      setState({
        mode,
        canEdit,
        isWaiting,
        currentParticipant,
        allParticipants,
        blockingParticipant,
        hasCompleted: currentParticipant?.status === 'completed',
        loading: false,
      });
    } catch (err) {
      console.error('Error fetching participants:', err);
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [dealId, user, isExternalUser, isInternalUser]);

  useEffect(() => {
    if (isInternalUser) return; // Skip for internal users
    fetchParticipants();
  }, [fetchParticipants, isInternalUser]);

  // Subscribe to realtime updates - only for external users
  useEffect(() => {
    if (!dealId || isInternalUser) return;

    const { unsubscribe } = subscribeToChanges({
      channelName: `deal-participants-${dealId}`,
      table: 'deal_participants',
      filter: `deal_id=eq.${dealId}`,
      onChange: () => {
        fetchParticipants();
      },
    });

    return unsubscribe;
  }, [dealId, fetchParticipants, isInternalUser]);

  const completeSection = useCallback(async (): Promise<boolean> => {
    if (!state.currentParticipant) {
      console.warn('No current participant to complete');
      return false;
    }

    try {
      let result: { success?: boolean; error?: string; nextParticipant?: unknown } | null;
      if (isNodeApiEnabled('deals')) {
        result = await apiClient.post<{ success: boolean; nextParticipant: unknown | null }>(
          `/deals/${dealId}/participants/${state.currentParticipant.id}/complete`,
          {},
        );
      } else {
        const { data, error } = await invokeCompleteParticipantSection({
          participantId: state.currentParticipant.id,
          dealId,
        });
        if (error) throw error;
        result = data as { success?: boolean; error?: string } | null;
      }

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to complete section');
      }

      await fetchParticipants();
      return true;
    } catch (err) {
      console.error('Error completing section:', err);
      return false;
    }
  }, [state.currentParticipant, dealId, fetchParticipants]);

  // For internal users, return static state with no-op functions
  if (isInternalUser) {
    return {
      ...INTERNAL_USER_DEFAULT,
      completeSection: noopComplete,
      refresh: noopRefresh,
    };
  }

  return {
    ...state,
    completeSection,
    refresh: fetchParticipants,
  };
}
