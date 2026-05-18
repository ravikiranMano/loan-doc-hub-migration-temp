import React from 'react';
import { format, parse, isValid } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ContactBroker } from '@/pages/contacts/ContactBrokersPage';

const formatAgreementDate = (val: string): string => {
  if (!val) return '';
  try { const d = parse(val, 'yyyy-MM-dd', new Date()); return isValid(d) ? format(d, 'MM/dd/yyyy') : val; } catch { return val; }
};

interface Props { broker: ContactBroker; onUpdate: (b: ContactBroker) => void; }

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-sm text-foreground">{value || '-'}</span>
  </div>
);

const BrokerDashboard: React.FC<Props> = ({ broker }) => (
  <div className="space-y-4">
    <h4 className="text-lg font-semibold text-foreground">Dashboard</h4>

    <div className="flex gap-2 flex-wrap">
      {broker.hold && <Badge variant="destructive">On Hold</Badge>}
      {broker.verified && <Badge variant="secondary">Verified</Badge>}
      {broker.agreement && <Badge variant="outline">Agreement on File</Badge>}
      {broker.send1099 && <Badge variant="outline">1099</Badge>}
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Basic Information</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Field label="Broker ID" value={broker.brokerId} />
          <Field label="Type" value={broker.type} />
          <Field label="Company" value={broker.company} />
          <Field label="License" value={broker.license} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Broker's Representative</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Field label="First Name" value={broker.firstName} />
          <Field label="Last Name" value={broker.lastName} />
          <Field label="Phone" value={broker.repPhone} />
          <Field label="Email" value={broker.repEmail} />
          <Field label="License" value={broker.repLicense} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Contact Information</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Field label="Email" value={broker.email} />
          <Field label="Cell Phone" value={broker.cellPhone} />
          <Field label="Home Phone" value={broker.homePhone} />
          <Field label="Work Phone" value={broker.workPhone} />
          <Field label="Fax" value={broker.fax} />
          <Field label="Preferred" value={broker.preferredPhone} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Address</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Field label="Street" value={broker.street} />
          <Field label="City" value={broker.city} />
          <Field label="State" value={broker.state} />
          <Field label="ZIP" value={broker.zip} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Financial / Compliance</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Field label="Send 1099" value={broker.send1099 ? 'Yes' : 'No'} />
          <Field label="Agreement" value={broker.agreement ? 'Yes' : 'No'} />
          <Field label="Agreement Date" value={formatAgreementDate(broker.agreementDate || '')} />
        </CardContent>
      </Card>
    </div>
  </div>
);

export default BrokerDashboard;
