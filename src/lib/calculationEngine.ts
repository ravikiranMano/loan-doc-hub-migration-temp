/**
 * Calculation Engine for Computed Fields
 * 
 * Provides deterministic calculations for deal fields based on formulas
 * defined in the field_dictionary.
 * 
 * Supported formula syntax:
 * - {field_key} + N months   → Adds N months to a date field
 * - {field_key} + N days     → Adds N days to a date field  
 * - {field_key} + {field_key2} months → Adds value of field2 as months to field1
 * - {field_key} + {field_key2} days   → Adds value of field2 as days to field1
 */

import { addMonths, addDays, parseISO, format, isValid } from 'date-fns';

export interface CalculatedField {
  field_key: string;
  calculation_formula: string;
  calculation_dependencies: string[];
  data_type: string;
}

export interface CalculationResult {
  field_key: string;
  value: string | null;
  computed: boolean;
  error?: string;
}

/**
 * Check if all dependencies have valid values
 */
function allDependenciesPresent(
  dependencies: string[],
  values: Record<string, string>
): boolean {
  return dependencies.every(dep => {
    const val = values[dep];
    return val !== undefined && val !== null && val.trim() !== '';
  });
}

/**
 * Parse a formula and extract the operation type
 * Examples:
 * - "{first_payment_date} + {term_months} months"
 * - "{next_due_date} + {grace_days} + 4 days"
 */
function parseFormula(formula: string): {
  type: 'date_add_months' | 'date_add_days' | 'arithmetic' | 'arithmetic_chained' | 'unknown';
  baseField: string;
  addendField: string | null;
  chainAddendField?: string | null;
  staticValue: number | null;
  operator?: '*' | '+' | '-' | '/';
  chainOperator?: '*' | '+' | '-' | '/';
} | null {
  const cleanFormula = formula.trim();

  // Chained arithmetic with field RHS: ({field1} op {field2}) op {field3}
  const chainedArithFieldPattern = /^\(\{([^}]+)\}\s*([+\-*/])\s*\{([^}]+)\}\)\s*([+\-*/])\s*\{([^}]+)\}$/;
  let match: RegExpMatchArray | null = cleanFormula.match(chainedArithFieldPattern);
  if (match) {
    return {
      type: 'arithmetic_chained',
      baseField: match[1],
      addendField: match[3],
      chainAddendField: match[5],
      staticValue: null,
      operator: match[2] as '*' | '+' | '-' | '/',
      chainOperator: match[4] as '*' | '+' | '-' | '/',
    };
  }

  // Chained arithmetic: ({field1} / {field2}) * N  e.g. LTV ratio
  const chainedArithPattern = /^\(\{([^}]+)\}\s*([+\-*/])\s*\{([^}]+)\}\)\s*([+\-*/])\s*(\d+(?:\.\d+)?)$/;
  match = cleanFormula.match(chainedArithPattern);
  if (match) {
    return {
      type: 'arithmetic_chained',
      baseField: match[1],
      addendField: match[3],
      staticValue: parseFloat(match[5]),
      operator: match[2] as '*' | '+' | '-' | '/',
      chainOperator: match[4] as '*' | '+' | '-' | '/',
    };
  }

  // Arithmetic: {field} * N  or  {field} + N  etc.
  const fieldArithStaticPattern = /^\{([^}]+)\}\s*([+\-*/])\s*(\d+(?:\.\d+)?)$/;
  match = cleanFormula.match(fieldArithStaticPattern);
  if (match) {
    return {
      type: 'arithmetic',
      baseField: match[1],
      addendField: null,
      staticValue: parseFloat(match[3]),
      operator: match[2] as '*' | '+' | '-' | '/',
    };
  }

  // Arithmetic: {field1} * {field2}
  const fieldArithFieldPattern = /^\{([^}]+)\}\s*([+\-*/])\s*\{([^}]+)\}$/;
  match = cleanFormula.match(fieldArithFieldPattern);
  if (match) {
    return {
      type: 'arithmetic',
      baseField: match[1],
      addendField: match[3],
      staticValue: null,
      operator: match[2] as '*' | '+' | '-' | '/',
    };
  }

  // Date patterns: {field1} + {field2} months
  const fieldAddPattern = /^\{([^}]+)\}\s*\+\s*\{([^}]+)\}\s*(months?|days?)$/i;
  match = cleanFormula.match(fieldAddPattern);
  if (match) {
    const unit = match[3].toLowerCase();
    return {
      type: unit.startsWith('month') ? 'date_add_months' : 'date_add_days',
      baseField: match[1],
      addendField: match[2],
      staticValue: null,
    };
  }
  
  // {field1} + {field2} + N days
  const fieldAndStaticPattern = /^\{([^}]+)\}\s*\+\s*\{([^}]+)\}\s*\+\s*(\d+)\s*(months?|days?)$/i;
  match = cleanFormula.match(fieldAndStaticPattern);
  if (match) {
    const unit = match[4].toLowerCase();
    return {
      type: unit.startsWith('month') ? 'date_add_months' : 'date_add_days',
      baseField: match[1],
      addendField: match[2],
      staticValue: parseInt(match[3], 10),
    };
  }
  
  // {field1} + N months
  const staticAddPattern = /^\{([^}]+)\}\s*\+\s*(\d+)\s*(months?|days?)$/i;
  match = cleanFormula.match(staticAddPattern);
  if (match) {
    const unit = match[3].toLowerCase();
    return {
      type: unit.startsWith('month') ? 'date_add_months' : 'date_add_days',
      baseField: match[1],
      addendField: null,
      staticValue: parseInt(match[2], 10),
    };
  }
  
  return null;
}

/**
 * Compute a single calculated field
 */
function computeField(
  field: CalculatedField,
  values: Record<string, string>
): CalculationResult {
  // Check if all dependencies are present
  if (!allDependenciesPresent(field.calculation_dependencies, values)) {
    return {
      field_key: field.field_key,
      value: null,
      computed: false,
    };
  }
  
  const parsed = parseFormula(field.calculation_formula);
  if (!parsed) {
    return {
      field_key: field.field_key,
      value: null,
      computed: false,
      error: `Unknown formula format: ${field.calculation_formula}`,
    };
  }
  
  try {
    const baseValue = values[parsed.baseField];
    
    if (parsed.type === 'arithmetic') {
      const baseNum = parseFloat(baseValue.replace(/[,$]/g, ''));
      if (isNaN(baseNum)) {
        return { field_key: field.field_key, value: null, computed: false, error: `Invalid numeric value for ${parsed.baseField}` };
      }
      let operand = parsed.staticValue || 0;
      if (parsed.addendField) {
        const addVal = parseFloat(values[parsed.addendField].replace(/[,$]/g, ''));
        if (isNaN(addVal)) {
          return { field_key: field.field_key, value: null, computed: false, error: `Invalid numeric value for ${parsed.addendField}` };
        }
        operand = addVal;
      }
      let result: number;
      switch (parsed.operator) {
        case '*': result = baseNum * operand; break;
        case '+': result = baseNum + operand; break;
        case '-': result = baseNum - operand; break;
        case '/':
          if (operand === 0) return { field_key: field.field_key, value: null, computed: false, error: 'Division by zero' };
          result = baseNum / operand; break;
        default: result = 0;
      }
      return { field_key: field.field_key, value: result.toFixed(2), computed: true };
    }

    if (parsed.type === 'arithmetic_chained') {
      const baseNum = parseFloat(baseValue.replace(/[,$]/g, ''));
      if (isNaN(baseNum)) {
        return { field_key: field.field_key, value: null, computed: false, error: `Invalid numeric value for ${parsed.baseField}` };
      }
      const addVal = parseFloat(values[parsed.addendField!].replace(/[,$]/g, ''));
      if (isNaN(addVal)) {
        return { field_key: field.field_key, value: null, computed: false, error: `Invalid numeric value for ${parsed.addendField}` };
      }
      // First operation: baseNum op addVal
      let intermediate: number;
      switch (parsed.operator) {
        case '/':
          if (addVal === 0) return { field_key: field.field_key, value: null, computed: false, error: 'Division by zero' };
          intermediate = baseNum / addVal; break;
        case '*': intermediate = baseNum * addVal; break;
        case '+': intermediate = baseNum + addVal; break;
        case '-': intermediate = baseNum - addVal; break;
        default: intermediate = 0;
      }
      // Chain operation: intermediate chainOp staticValue
      const chainVal = parsed.staticValue || 0;
      let result: number;
      switch (parsed.chainOperator) {
        case '*': result = intermediate * chainVal; break;
        case '+': result = intermediate + chainVal; break;
        case '-': result = intermediate - chainVal; break;
        case '/':
          if (chainVal === 0) return { field_key: field.field_key, value: null, computed: false, error: 'Division by zero' };
          result = intermediate / chainVal; break;
        default: result = intermediate;
      }
      return { field_key: field.field_key, value: result.toFixed(2), computed: true };
    }

    if (parsed.type === 'date_add_months' || parsed.type === 'date_add_days') {
      // Parse the base date
      const baseDate = parseISO(baseValue);
      if (!isValid(baseDate)) {
        return {
          field_key: field.field_key,
          value: null,
          computed: false,
          error: `Invalid date value for ${parsed.baseField}`,
        };
      }
      
      // Get the amount to add
      let amount = parsed.staticValue || 0;
      if (parsed.addendField) {
        const addendValue = parseFloat(values[parsed.addendField]);
        if (isNaN(addendValue)) {
          return {
            field_key: field.field_key,
            value: null,
            computed: false,
            error: `Invalid numeric value for ${parsed.addendField}`,
          };
        }
        amount += addendValue;
      }
      
      // Compute the result
      const resultDate = parsed.type === 'date_add_months'
        ? addMonths(baseDate, amount)
        : addDays(baseDate, amount);
      
      return {
        field_key: field.field_key,
        value: format(resultDate, 'yyyy-MM-dd'),
        computed: true,
      };
    }
    
    return {
      field_key: field.field_key,
      value: null,
      computed: false,
      error: 'Unsupported calculation type',
    };
  } catch (err: any) {
    return {
      field_key: field.field_key,
      value: null,
      computed: false,
      error: err.message || 'Calculation error',
    };
  }
}

/**
 * Compute all calculated fields based on current values
 * Returns a map of field_key -> computed value
 */
export function computeCalculatedFields(
  calculatedFields: CalculatedField[],
  values: Record<string, string>
): Record<string, CalculationResult> {
  const results: Record<string, CalculationResult> = {};
  
  // Sort fields by dependency order (simple topological sort)
  // Fields with fewer dependencies computed first
  const sortedFields = [...calculatedFields].sort((a, b) => 
    a.calculation_dependencies.length - b.calculation_dependencies.length
  );
  
  // Working copy of values (in case calculated fields depend on each other)
  const workingValues = { ...values };
  
  for (const field of sortedFields) {
    const result = computeField(field, workingValues);
    results[field.field_key] = result;
    
    // Update working values if computed successfully
    if (result.computed && result.value !== null) {
      workingValues[field.field_key] = result.value;
    }
  }
  
  return results;
}

/**
 * Merge computed values into existing values
 */
export function mergeCalculatedValues(
  values: Record<string, string>,
  results: Record<string, CalculationResult>
): Record<string, string> {
  const merged = { ...values };
  
  for (const [fieldKey, result] of Object.entries(results)) {
    if (result.computed && result.value !== null) {
      merged[fieldKey] = result.value;
    }
  }
  
  return merged;
}

/**
 * Get list of calculated field keys that failed to compute
 */
export function getCalculationErrors(
  results: Record<string, CalculationResult>
): Array<{ field_key: string; error: string }> {
  return Object.values(results)
    .filter(r => r.error)
    .map(r => ({ field_key: r.field_key, error: r.error! }));
}
