import { supabase } from '@/services/supabase/client';
import { getSession } from '@/services/supabase/auth';

export async function invokeFunction<T = unknown>(
  name: string,
  body?: Record<string, unknown>
): Promise<{ data: T | null; error: Error | null }> {
  const response = await supabase.functions.invoke(name, { body });
  if (response.error) {
    return { data: null, error: response.error as Error };
  }
  return { data: response.data as T, error: null };
}

export async function invokeFunctionWithAuth<T = unknown>(
  name: string,
  body?: Record<string, unknown>
): Promise<T> {
  const { data: sessionData } = await getSession();
  const token =
    sessionData.session?.access_token ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error((errorData as { error?: string }).error || `${name} failed`);
  }

  return response.json() as Promise<T>;
}

export const invokeGenerateDocument = (body: Record<string, unknown>) =>
  invokeFunction('generate-document', body);

export const invokeSendParticipantInvite = (body: Record<string, unknown>) =>
  invokeFunction('send-participant-invite', body);

export const invokeSendMessage = (body: Record<string, unknown>) =>
  invokeFunction('send-message', body);

export const invokeCompleteParticipantSection = (body: Record<string, unknown>) =>
  invokeFunction('complete-participant-section', body);

export const invokeValidateMagicLink = (token: string) =>
  invokeFunction('validate-magic-link', { token });

export const invokeValidateTemplate = (templateId: string) =>
  invokeFunctionWithAuth('validate-template', { templateId });
