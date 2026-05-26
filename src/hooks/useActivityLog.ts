/**
 * Activity Log Hook
 * 
 * Provides functions to log deal-related activities for accountability.
 */

import { getMe } from '@/services/node-api/auth.service';
import { insertActivityLog } from '@/services/system/activity-log.service';

export type ActionType = 
  | 'DealCreated'
  | 'DealUpdated'
  | 'DataSaved'
  | 'DealMarkedReady'
  | 'DealRevertedToDraft'
  | 'FieldUpdated'
  | 'FieldOverwritten'
  | 'FieldUpdatedByExternal'
  | 'ParticipantInvited'
  | 'ParticipantRemoved'
  | 'ParticipantCompleted'
  | 'MagicLinkAccessed'
  | 'AccessRevoked'
  | 'AccessExpired'
  | 'ParticipantStatusReset'
  | 'ExternalDataReviewed'
  | 'DocumentGenerated'
  | 'DocumentRegenerated';

export interface ActivityLogEntry {
  id: string;
  deal_id: string;
  actor_user_id: string;
  action_type: ActionType;
  action_details: Record<string, any> | null;
  created_at: string;
}

export interface LogActivityParams {
  dealId: string;
  actionType: ActionType;
  actionDetails?: Record<string, any>;
}

/**
 * Log an activity for a deal
 */
export async function logActivity(params: LogActivityParams): Promise<boolean> {
  try {
    const user = await getMe();
    if (!user?.id) {
      console.warn('Cannot log activity: user not authenticated');
      return false;
    }

    await insertActivityLog({
      deal_id: params.dealId,
      actor_user_id: user.id,
      action_type: params.actionType,
      action_details: params.actionDetails || null,
    });

    return true;
  } catch (err) {
    console.error('Error logging activity:', err);
    return false;
  }
}

/**
 * Log deal creation
 */
export async function logDealCreated(dealId: string, details?: {
  dealNumber?: string;
  state?: string;
  productType?: string;
  mode?: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'DealCreated',
    actionDetails: details,
  });
}

/**
 * Log deal draft saved
 */
export async function logDealUpdated(dealId: string, details?: Record<string, any>): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'DealUpdated',
    actionDetails: details,
  });
}

/**
 * Log participant invited
 */
export async function logParticipantInvited(dealId: string, details: {
  role: string;
  email: string;
  accessMethod: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'ParticipantInvited',
    actionDetails: details,
  });
}

/**
 * Log participant removed
 */
export async function logParticipantRemoved(dealId: string, details: {
  role: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'ParticipantRemoved',
    actionDetails: details,
  });
}

/**
 * Log deal marked as ready
 */
export async function logDealMarkedReady(dealId: string, details?: {
  requiredFieldsCount?: number;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'DealMarkedReady',
    actionDetails: details,
  });
}

/**
 * Log deal reverted to draft due to field change
 */
export async function logDealRevertedToDraft(dealId: string, details?: {
  reason?: string;
  fieldChanged?: string;
  previousStatus?: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'DealRevertedToDraft',
    actionDetails: details,
  });
}

/**
 * Log specific field update (for important fields)
 */
export async function logFieldUpdated(dealId: string, details: {
  fieldKey: string;
  fieldLabel?: string;
  oldValue?: string;
  newValue?: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'FieldUpdated',
    actionDetails: details,
  });
}

/**
 * Log when CSR overwrites external user data
 */
export async function logFieldOverwritten(dealId: string, details: {
  fieldKey: string;
  fieldLabel?: string;
  previousValue?: string;
  newValue?: string;
  previousUpdatedBy?: string;
  previousUpdaterRole?: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'FieldOverwritten',
    actionDetails: details,
  });
}

/**
 * Log when CSR reviews external modifications
 */
export async function logExternalDataReviewed(dealId: string, details: {
  fieldsReviewed: number;
  fieldKeys: string[];
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'ExternalDataReviewed',
    actionDetails: details,
  });
}

/**
 * Log when external user updates a field
 */
export async function logFieldUpdatedByExternal(dealId: string, details: {
  fieldKey: string;
  fieldLabel?: string;
  role: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'FieldUpdatedByExternal',
    actionDetails: details,
  });
}

/**
 * Log when magic link is accessed
 */
export async function logMagicLinkAccessed(dealId: string, details: {
  role: string;
  participantId: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'MagicLinkAccessed',
    actionDetails: details,
  });
}

/**
 * Log when CSR revokes participant access
 */
export async function logAccessRevoked(dealId: string, details: {
  role: string;
  participantId: string;
  email?: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'AccessRevoked',
    actionDetails: details,
  });
}

/**
 * Log when participant access expires
 */
export async function logAccessExpired(dealId: string, details: {
  role: string;
  participantId: string;
  reason?: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'AccessExpired',
    actionDetails: details,
  });
}

/**
 * Log when CSR resets participant status
 */
export async function logParticipantStatusReset(dealId: string, details: {
  role: string;
  participantId: string;
  previousStatus: string;
}): Promise<boolean> {
  return logActivity({
    dealId,
    actionType: 'ParticipantStatusReset',
    actionDetails: details,
  });
}
