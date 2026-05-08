import React from 'react';

interface Row {
  type: string;
  value: 'Yes' | 'No' | '';
}

const ROWS: Row[] = [
  { type: 'Individual', value: 'Yes' },
  { type: 'Joint', value: 'Yes' },
  { type: 'Family Trust', value: 'Yes' },
  { type: 'LLC', value: '' },
  { type: 'C Corp / S Corp', value: 'No' },
  { type: 'IRA / ERISA', value: 'No' },
  { type: 'Investment Fund', value: '' },
  { type: '401K', value: 'No' },
  { type: 'Foreign Holder W-8', value: 'No' },
  { type: 'Non-profit', value: 'No' },
];

interface Props {
  /** Header label for the entity-type column. Defaults to "Lender Type". */
  typeLabel?: string;
}

/**
 * Read-only reference lookup table mapping entity type → Issue 1099 default.
 * The "Issue 1099" column header has a green/teal border to indicate it
 * drives the active/editable field.
 */
const Issue1099ReferenceTable: React.FC<Props> = ({ typeLabel = 'Lender Type' }) => {
  return (
    <div className="inline-block">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className="border border-border px-3 py-1 text-left font-semibold bg-muted/30">
              {typeLabel}
            </th>
            <th className="border-2 border-emerald-500 px-3 py-1 text-center font-semibold bg-muted/30">
              Issue 1099
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.type}>
              <td className="border border-border px-3 py-1 text-left">{r.type}</td>
              <td className="border border-border px-3 py-1 text-center">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Issue1099ReferenceTable;
