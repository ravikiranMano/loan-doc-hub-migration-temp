import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  validateMagicLink, 
  storeMagicLinkSession,
  getMagicLinkSession 
} from '@/lib/magicLink';
import { getRoleDisplayName } from '@/lib/accessControl';
import type { AppRole } from '@/types';

export const MagicLinkAccessPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  
  const [status, setStatus] = useState<'validating' | 'valid' | 'invalid' | 'error'>('validating');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [dealInfo, setDealInfo] = useState<{
    dealId: string;
    dealNumber: string;
    role: AppRole;
    participantId: string;
  } | null>(null);

  useEffect(() => {
    if (token) {
      validateToken(token);
    } else {
      setStatus('invalid');
      setErrorMessage('No access token provided');
    }
  }, [token]);

  const validateToken = async (token: string) => {
    setStatus('validating');
    
    const result = await validateMagicLink(token);
    
    if (!result.isValid) {
      setStatus('invalid');
      setErrorMessage(result.error || 'This link is invalid or has expired');
      return;
    }

    // Store session
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours
    storeMagicLinkSession({
      dealId: result.dealId!,
      role: result.role!,
      participantId: result.participantId!,
      dealNumber: result.dealNumber!,
      sessionToken: result.sessionToken!,
      expiresAt: expiresAt.toISOString(),
    });

    setDealInfo({
      dealId: result.dealId!,
      dealNumber: result.dealNumber!,
      role: result.role as AppRole,
      participantId: result.participantId!,
    });
    
    setStatus('valid');
  };

  const handleContinue = () => {
    if (dealInfo) {
      navigate(`/deals/${dealInfo.dealId}/data`);
    }
  };

  if (status === 'validating') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium text-foreground">Validating your access...</p>
            <p className="text-sm text-muted-foreground mt-2">Please wait while we verify your link</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'invalid' || status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-6">
              If you believe this is an error, please contact your loan officer for a new access link.
            </p>
            <Button variant="outline" onClick={() => navigate('/')}>
              Return to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-6 w-6 text-success" />
          </div>
          <CardTitle>Access Granted</CardTitle>
          <CardDescription>
            Your access link has been verified successfully
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">File Number</p>
                <p className="text-sm text-muted-foreground">{dealInfo?.dealNumber}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 flex items-center justify-center">
                <span className="text-lg">👤</span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Your Role</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {dealInfo?.role ? getRoleDisplayName(dealInfo.role) : ''}
                </p>
              </div>
            </div>
          </div>

          <div className="text-sm text-muted-foreground text-center">
            <p>You will have access to view and complete the fields assigned to your role.</p>
            <p className="mt-1">This session will expire in 4 hours.</p>
          </div>

          <Button onClick={handleContinue} className="w-full">
            Continue to File
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default MagicLinkAccessPage;
