import { JsonView, defaultStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

interface FieldDataJsonViewProps {
  data: Record<string, unknown>;
  /** Expand root and one level of nesting (e.g. properties[] rows). */
  className?: string;
}

/** Read-only collapsible JSON tree for docxtemplater field-data inspect. */
export function FieldDataJsonView({ data, className }: FieldDataJsonViewProps) {
  return (
    <div className={className}>
      <JsonView
        data={data}
        shouldExpandNode={(level) => level < 2}
        style={defaultStyles}
      />
    </div>
  );
}
