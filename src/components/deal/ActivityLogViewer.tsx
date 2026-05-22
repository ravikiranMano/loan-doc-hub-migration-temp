import React, { useState, useEffect } from 'react';
import { listActivityLog } from '@/services/system/activity-log.service';
import { fetchProfilesByUserIds } from '@/services/admin/profiles.service';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  FileText, 
  Save, 
  CheckCircle2, 
  RotateCcw, 
  Edit3,
  Clock,
  User,
  AlertTriangle,
  Eye,
  Link2,
  ShieldOff,
  Timer,
  RefreshCw,
  UserCheck,
  FileOutput,
  FilePlus
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { ActionType } from '@/hooks/useActivityLog';

interface ActivityLogEntry {
  id: string;
  deal_id: string;
  actor_user_id: string;
  action_type: string;
  action_details: unknown;
  created_at: string;
}

interface ActivityLogViewerProps {
  dealId: string;
  maxHeight?: string;
}

const ACTION_CONFIG: Record<ActionType, {
  icon: React.ElementType;
  label: string;
  color: string;
  bgColor: string;
}> = {
  DealCreated: {
    icon: FileText,
    label: 'File Created',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  DealUpdated: {
    icon: Save,
    label: 'Draft Saved',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
  },
  DataSaved: {
    icon: Save,
    label: 'Data Saved',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  DealMarkedReady: {
    icon: CheckCircle2,
    label: 'Marked Ready',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  DealRevertedToDraft: {
    icon: RotateCcw,
    label: 'Reverted to Draft',
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
  },
  FieldUpdated: {
    icon: Edit3,
    label: 'Field Updated',
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
  },
  FieldUpdatedByExternal: {
    icon: UserCheck,
    label: 'External Field Update',
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-100',
  },
  ParticipantInvited: {
    icon: User,
    label: 'Participant Invited',
    color: 'text-teal-600',
    bgColor: 'bg-teal-100',
  },
  ParticipantRemoved: {
    icon: User,
    label: 'Participant Removed',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
  },
  ParticipantCompleted: {
    icon: CheckCircle2,
    label: 'Section Completed',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-100',
  },
  MagicLinkAccessed: {
    icon: Link2,
    label: 'Link Accessed',
    color: 'text-sky-600',
    bgColor: 'bg-sky-100',
  },
  AccessRevoked: {
    icon: ShieldOff,
    label: 'Access Revoked',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
  },
  AccessExpired: {
    icon: Timer,
    label: 'Access Expired',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
  },
  ParticipantStatusReset: {
    icon: RefreshCw,
    label: 'Status Reset',
    color: 'text-violet-600',
    bgColor: 'bg-violet-100',
  },
  FieldOverwritten: {
    icon: AlertTriangle,
    label: 'Field Overwritten',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
  },
  ExternalDataReviewed: {
    icon: Eye,
    label: 'External Data Reviewed',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-100',
  },
  DocumentGenerated: {
    icon: FilePlus,
    label: 'Document Generated',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  DocumentRegenerated: {
    icon: FileOutput,
    label: 'Document Regenerated',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
};

export const ActivityLogViewer: React.FC<ActivityLogViewerProps> = ({
  dealId,
  maxHeight = '400px',
}) => {
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActivities();
  }, [dealId]);

  const fetchActivities = async () => {
    try {
      setLoading(true);
      
      const data = await listActivityLog(dealId);
      
      setActivities(data || []);
      
      const actorIds = [...new Set((data || []).map((a: ActivityLogEntry) => a.actor_user_id))];
      if (actorIds.length > 0) {
        const profiles = await fetchProfilesByUserIds(actorIds);
        
        const names: Record<string, string> = {};
        (profiles || []).forEach(p => {
          names[p.user_id] = p.full_name || p.email || 'Unknown User';
        });
        setActorNames(names);
      }
    } catch (err) {
      console.error('Error fetching activities:', err);
    } finally {
      setLoading(false);
    }
  };

  const getActionConfig = (actionType: string) => {
    return ACTION_CONFIG[actionType as ActionType] || {
      icon: Clock,
      label: actionType,
      color: 'text-gray-600',
      bgColor: 'bg-gray-100',
    };
  };

  const formatDetails = (actionType: string, details: unknown): string | null => {
    if (!details || typeof details !== 'object') return null;
    const d = details as Record<string, any>;
    if (!details) return null;
    
    switch (actionType) {
      case 'DealCreated':
        return d.dealNumber ? `File #${d.dealNumber}` : null;
      case 'DealUpdated':
        if (d.fieldsUpdated !== undefined) {
          return `${d.fieldsUpdated} of ${d.fieldsTotal || '?'} fields saved`;
        }
        return null;
      case 'DataSaved':
        if (d.fields_count !== undefined) {
          return `${d.fields_count} fields saved`;
        }
        return null;
      case 'DealMarkedReady':
        return d.requiredFieldsCount 
          ? `${d.requiredFieldsCount} required fields complete`
          : null;
      case 'DealRevertedToDraft':
        return d.reason || (d.fieldChanged ? `Field changed: ${d.fieldChanged}` : null);
      case 'FieldUpdated':
        return d.fieldLabel || d.fieldKey;
      case 'FieldUpdatedByExternal':
        return d.role ? `${d.fieldLabel || d.fieldKey} by ${d.role}` : (d.fieldLabel || d.fieldKey);
      case 'FieldOverwritten':
        return `${d.fieldLabel || d.fieldKey} (was edited by ${d.previousUpdaterRole || 'external user'})`;
      case 'ExternalDataReviewed':
        return d.fieldsReviewed ? `${d.fieldsReviewed} field${d.fieldsReviewed > 1 ? 's' : ''} reviewed` : null;
      case 'ParticipantInvited':
        return d.role ? `${d.role} invited via ${d.accessMethod || 'email'}` : null;
      case 'ParticipantRemoved':
        return d.role || null;
      case 'ParticipantCompleted':
        return d.role ? `${d.role} completed their section` : null;
      case 'MagicLinkAccessed':
        return d.role ? `${d.role} accessed the file` : null;
      case 'AccessRevoked':
        return d.role ? `${d.role}'s access was revoked${d.email ? ` (${d.email})` : ''}` : null;
      case 'AccessExpired':
        return d.role ? `${d.role}'s access expired${d.reason ? `: ${d.reason}` : ''}` : null;
      case 'ParticipantStatusReset':
        return d.role ? `${d.role} reset from ${d.previousStatus}` : null;
      case 'DocumentGenerated':
        return d.templateName ? `${d.templateName} v${d.versionNumber || 1}` : null;
      case 'DocumentRegenerated':
        return d.templateName ? `${d.templateName} v${d.versionNumber || 1}` : null;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No activity recorded yet</p>
      </div>
    );
  }

  return (
    <div style={{ maxHeight }} className="overflow-y-auto pr-4">
      <div className="space-y-4">
        {activities.map((activity, index) => {
          const config = getActionConfig(activity.action_type);
          const Icon = config.icon;
          const details = formatDetails(activity.action_type, activity.action_details);
          const actorName = actorNames[activity.actor_user_id] || 'Unknown User';
          const createdAt = new Date(activity.created_at);
          
          return (
            <div 
              key={activity.id}
              className={cn(
                'flex gap-3 relative',
                index < activities.length - 1 && 'pb-4'
              )}
            >
              {/* Timeline connector */}
              {index < activities.length - 1 && (
                <div className="absolute left-4 top-8 bottom-0 w-px bg-border" />
              )}
              
              {/* Icon */}
              <div className={cn(
                'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center z-10',
                config.bgColor
              )}>
                <Icon className={cn('h-4 w-4', config.color)} />
              </div>
              
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={cn('text-xs', config.color)}>
                    {config.label}
                  </Badge>
                  {details && (
                    <span className="text-sm text-muted-foreground truncate">
                      {details}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    <span>{actorName}</span>
                  </div>
                  <span>•</span>
                  <time 
                    dateTime={activity.created_at}
                    title={format(createdAt, 'PPpp')}
                  >
                    {formatDistanceToNow(createdAt, { addSuffix: true })}
                  </time>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ActivityLogViewer;
