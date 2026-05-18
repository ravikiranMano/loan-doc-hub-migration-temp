import React from 'react';
import { format, parse, isValid } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ContactRecord } from '@/hooks/useContactsCrud';

const formatAgreementDate = (val: string): string => {
  if (!val) return '';
  try { const d = parse(val, 'yyyy-MM-dd', new Date()); return isValid(d) ? format(d, 'MM/dd/yyyy') : val; } catch { return val; }
};

interface Props { contact: ContactRecord; }

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-sm text-foreground">{value || '-'}</span>
  </div>
);

const LenderDashboard: React.FC<Props> = ({ contact }) => {
  const data = (contact.contact_data || {}) as Record<string, string>;

  return (
    <div className="space-y-4">
      <h4 className="text-lg font-semibold text-foreground">Dashboard</h4>

      <div className="flex gap-2 flex-wrap">
        {data.frozen === 'true' && <Badge variant="destructive">Frozen</Badge>}
        {data.tin_verified === 'true' && <Badge variant="secondary">Verified</Badge>}
        {data.ach === 'true' && <Badge variant="outline">ACH</Badge>}
        {data.agreement_on_file === 'true' && <Badge variant="outline">Agreement on File</Badge>}
        {data.send_1099 === 'true' && <Badge variant="outline">1099</Badge>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Basic Information</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="Lender ID" value={contact.contact_id} />
            <Field label="Type" value={data.type || ''} />
            <Field label="Full Name" value={contact.full_name || ''} />
            <Field label="First Name" value={contact.first_name || ''} />
            <Field label="Last Name" value={contact.last_name || ''} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Contact Information</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="Email" value={contact.email || ''} />
            <Field label="Cell Phone" value={data['phone.cell'] || ''} />
            <Field label="Home Phone" value={data['phone.home'] || ''} />
            <Field label="Work Phone" value={data['phone.work'] || ''} />
            <Field label="Fax" value={data['phone.fax'] || ''} />
            <Field label="Preferred" value={
              data['preferred.home'] === 'true' ? 'Home' :
              data['preferred.work'] === 'true' ? 'Work' :
              data['preferred.cell'] === 'true' ? 'Cell' :
              data['preferred.fax'] === 'true' ? 'Fax' :
              data.preferred_phone || ''
            } />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Primary Address</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="Street" value={data['primary_address.street'] || ''} />
            <Field label="City" value={contact.city || ''} />
            <Field label="State" value={contact.state || ''} />
            <Field label="ZIP" value={data['primary_address.zip'] || ''} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Financial / Compliance</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="TIN" value={data.tax_id || data.tin || ''} />
            <Field label="ACH" value={data.ach === 'true' ? 'Yes' : 'No'} />
            <Field label="Send 1099" value={data.send_1099 === 'true' ? 'Yes' : 'No'} />
            <Field label="Agreement" value={data.agreement_on_file === 'true' ? 'Yes' : 'No'} />
            <Field label="Agreement Date" value={formatAgreementDate(data.servicing_agreement_on_file_date || data.agreement_on_file_date || '')} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LenderDashboard;
