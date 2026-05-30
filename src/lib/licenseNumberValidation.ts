export const LICENSE_NUMBER_PATTERN = /^[A-Za-z0-9\- ]{1,50}$/;

export const sanitizeLicenseNumber = (value: string): string =>
  (value || '').replace(/[^A-Za-z0-9\- ]/g, '').slice(0, 50);

export const normalizeLicenseNumber = (value: string): string =>
  sanitizeLicenseNumber(value).trim();

export const getLicenseNumberError = (value: string, required = false): string => {
  const raw = value || '';
  const trimmed = raw.trim();

  if (!trimmed) return required ? 'Please enter a valid license number.' : '';
  if (raw.length > 50) return 'License Number cannot exceed 50 characters.';
  if (!LICENSE_NUMBER_PATTERN.test(raw)) return 'Please enter a valid license number.';

  return '';
};

export const normalizeBrokerLicenseFields = <T extends Record<string, any>>(contactData: T): T => ({
  ...contactData,
  ...(contactData.License !== undefined ? { License: normalizeLicenseNumber(String(contactData.License)) } : {}),
  ...(contactData.license !== undefined ? { license: normalizeLicenseNumber(String(contactData.license)) } : {}),
  ...(contactData.rep_license !== undefined ? { rep_license: normalizeLicenseNumber(String(contactData.rep_license)) } : {}),
  ...(contactData.repLicense !== undefined ? { repLicense: normalizeLicenseNumber(String(contactData.repLicense)) } : {}),
});

export const validateBrokerLicenseFields = (contactData: Record<string, any>): string | null => {
  const fields = [
    ['License', 'License Number'],
    ['license', 'License Number'],
    ['rep_license', 'Broker/Representative License Number'],
    ['repLicense', 'Broker/Representative License Number'],
  ] as const;

  for (const [key, label] of fields) {
    if (contactData[key] === undefined) continue;
    const error = getLicenseNumberError(String(contactData[key] || ''));
    if (error) return `${label}: ${error}`;
  }

  return null;
};