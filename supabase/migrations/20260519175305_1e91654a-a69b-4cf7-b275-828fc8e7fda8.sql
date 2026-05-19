-- Legacy sold_rate field id (loan_terms.sold_rate): bdcacf8b-c929-444a-9aa9-f3562a7bf281
-- Authoritative sold_rate_company field id:         97fdfd8a-76b1-4970-85c7-c2138b87150a
-- Strip the legacy entry from any deal where it has been superseded by sold_rate_company.
UPDATE public.deal_section_values
SET field_values = field_values - 'bdcacf8b-c929-444a-9aa9-f3562a7bf281',
    updated_at = now()
WHERE section = 'loan_terms'
  AND field_values ? 'bdcacf8b-c929-444a-9aa9-f3562a7bf281'
  AND field_values ? '97fdfd8a-76b1-4970-85c7-c2138b87150a';