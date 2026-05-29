import React from 'react';
import { DealFieldInput } from './DealFieldInput';
import { AlertCircle, CheckCircle2, Lock, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FieldDefinition } from '@/hooks/useDealFields';
import type { CalculationResult } from '@/lib/calculationEngine';
import { getValueForResolvedField } from '@/lib/requiredFieldsResolver';
import { useFieldPermissions } from '@/hooks/useFieldPermissions';
import { useAuth } from '@/contexts/AuthContext';
import { getRoleDisplayName } from '@/lib/accessControl';

interface DealSectionTabProps {
  fields: FieldDefinition[];
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  missingRequiredFields: FieldDefinition[];
  showValidation?: boolean;
  calculationResults?: Record<string, CalculationResult>;
  /** Orchestration: whether the current user can edit (for external users) */
  orchestrationCanEdit?: boolean;
  /** Orchestration: whether waiting for previous participant */
  isWaitingForPrevious?: boolean;
  /** Orchestration: the role blocking the current user */
  blockingRole?: string | null;
  /** Orchestration: whether the section is already completed */
  hasCompleted?: boolean;
  /** Hide the validation status banner (for sections that don't need it) */
  hideValidationStatus?: boolean;
  /** Hide placeholders for input fields */
  hidePlaceholders?: boolean;
  /** Custom grid columns class (e.g., 'grid-cols-2' for 2 columns) */
  gridColumnsClass?: string;
}

export const DealSectionTab: React.FC<DealSectionTabProps> = ({
  fields,
  values,
  onValueChange,
  missingRequiredFields,
  showValidation = false,
  calculationResults = {},
  orchestrationCanEdit = true,
  isWaitingForPrevious = false,
  blockingRole = null,
  hasCompleted = false,
  hideValidationStatus = false,
  hidePlaceholders = false,
  gridColumnsClass,
}) => {
  const { checkCanView, checkCanEdit } = useFieldPermissions();
  const { isExternalUser } = useAuth();
  const missingFieldKeys = new Set(
    missingRequiredFields
      .filter((f) => !getValueForResolvedField(values, f))
      .map((f) => f.field_key),
  );

  // Filter fields based on view permissions for external users
  const visibleFields = isExternalUser 
    ? fields.filter(f => checkCanView(f.field_key))
    : fields;

  // Create a map of which fields are read-only for the current user
  // Include orchestration-based restrictions for external users
  const readOnlyFields = new Set(
    visibleFields
      .filter(f => {
        // Field-level permission check
        if (!checkCanEdit(f.field_key)) return true;
        // Orchestration-based restriction (external users or form-permission disabled)
        if (!orchestrationCanEdit) return true;
        return false;
      })
      .map(f => f.field_key)
  );

  if (visibleFields.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          {fields.length === 0 ? 'No fields in this section' : 'No accessible fields in this section'}
        </p>
      </div>
    );
  }

  // Recalculate missing based on visible fields only
  const visibleMissingFields = missingRequiredFields.filter(f => 
    visibleFields.some(vf => vf.field_key === f.field_key)
  );
  
  const isComplete = visibleMissingFields.length === 0;
  const requiredFields = visibleFields.filter(f => f.is_required);
  const filledRequired = requiredFields.filter(f => !missingFieldKeys.has(f.field_key));

  return (
    <div className="space-y-4">
      {/* Waiting/Locked banner for sequential mode */}
      {isExternalUser && isWaitingForPrevious && blockingRole && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted border border-border">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">Waiting for previous participant</p>
            <p className="text-sm text-muted-foreground">
              The {getRoleDisplayName(blockingRole as any)} must complete their section before you can enter data.
            </p>
          </div>
        </div>
      )}

      {/* Completed banner */}
      {isExternalUser && hasCompleted && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-success/10 border border-success/20">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div>
            <p className="font-medium text-foreground">Section completed</p>
            <p className="text-sm text-muted-foreground">
              You have already completed your section. Fields are now read-only.
            </p>
          </div>
        </div>
      )}

      {/* Read-only mode indicator (not waiting, not completed, but can't edit) */}
      {isExternalUser && !orchestrationCanEdit && !isWaitingForPrevious && !hasCompleted && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted border border-border">
          <Lock className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium text-foreground">View only</p>
            <p className="text-sm text-muted-foreground">
              You can view but not edit these fields.
            </p>
          </div>
        </div>
      )}

      {/* Section status - hidden for specific sections */}
      {!hideValidationStatus && (
        <div className="flex justify-end">
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" />
            <span>All required fields completed</span>
          </div>
        </div>
      )}

      {/* Fields grid - responsive from 1 to 4 columns */}
      <div className={cn(
        "grid gap-x-6 gap-y-1.5",
        gridColumnsClass || "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      )}>
        {visibleFields.map(field => {
          // Non-input types (section, label, template, action) render differently
          const isNonInputType = ['section', 'label', 'template', 'action'].includes(field.data_type);
          
          if (isNonInputType) {
            // Non-input types get full width and simpler rendering
            return (
              <div 
                key={field.field_key} 
                className={cn(
                  field.data_type === 'section' && 'col-span-full',
                  field.data_type === 'label' && 'col-span-full'
                )}
              >
                <DealFieldInput
                  field={field}
                  value={getValueForResolvedField(values, field)}
                  onChange={(value) => onValueChange(field.field_key, value)}
                  error={false}
                  showValidation={false}
                  disabled={true}
                />
              </div>
            );
          }
          
          // Standard input fields
          return (
            <DealFieldInput
              key={field.field_key}
              field={field}
              value={getValueForResolvedField(values, field)}
              onChange={(value) => onValueChange(field.field_key, value)}
              error={missingFieldKeys.has(field.field_key)}
              showValidation={showValidation}
              calculationResult={calculationResults[field.field_key]}
              disabled={readOnlyFields.has(field.field_key)}
              hidePlaceholder={hidePlaceholders}
            />
          );
        })}
      </div>
    </div>
  );
};

export default DealSectionTab;
