import { useState, useEffect } from 'react';
import { ErrorBoundary } from "@/components/error-boundary";
import { useLocation, useSearch } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { parseRetryAfterSeconds } from '@/lib/queryClient';
import {
  DEFAULT_THROTTLE_FALLBACK_SECONDS,
  formatCountdown,
  useThrottleCountdown,
} from '@/hooks/use-throttle-countdown';
import {
  LANGUAGE_AUTO,
  LANGUAGE_OPTIONS,
  languageSelectionToWire,
} from '@/lib/preferred-language';
import { AlertTriangle, Loader2, Check, X, Eye, EyeOff } from 'lucide-react';
import { PageLoadingState } from "@/components/page-states";

export default function SetPasswordPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();

  const [token, setToken] = useState('');
  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  // The validate-invite endpoint returns only a masked email
  // (e.g. j***@example.com). Token-gated, but the link can still
  // be forwarded; we surface enough to confirm "this link is for
  // you" without disclosing the full address or the user's name.
  const [userEmail, setUserEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  // Task #420: capture the user's preferred language BEFORE the
  // first onboarding email goes out. Defaults to AUTO so brand-new
  // invitees who don't touch the picker keep the existing
  // English-fallback behaviour. The sentinel is mapped back to
  // `null` at the submit boundary via `languageSelectionToWire`.
  const [preferredLanguage, setPreferredLanguage] = useState<string>(LANGUAGE_AUTO);
  // Tracks whether the user actively chose a language — i.e.
  // interacted with the Select. If they DIDN'T, the form must
  // omit `preferredLanguage` from the request body entirely.
  // Otherwise this page (which is reused by the forgot-password
  // reset flow) would silently wipe a returning user's previously
  // saved `users.preferred_language` to null on every routine
  // password reset, undoing the choice they made in account
  // settings (#417). The server's "field omitted = leave column
  // untouched" tri-state semantics rely on this.
  const [languageTouched, setLanguageTouched] = useState(false);
  const handleLanguageChange = (value: string) => {
    setPreferredLanguage(value);
    setLanguageTouched(true);
  };
  const { isThrottled, remainingSeconds, throttle } = useThrottleCountdown();

  const requirements = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { label: 'One number', met: /[0-9]/.test(password) },
    { label: 'One special character (!@#$%^&*)', met: /[!@#$%^&*]/.test(password) },
  ];

  const allMet = requirements.every(r => r.met);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  useEffect(() => {
    const params = new URLSearchParams(search);
    const t = params.get('token');
    if (!t) {
      setValidating(false);
      setErrorMessage('No invitation token provided. Please use the link from your email.');
      return;
    }
    setToken(t);

    fetch(`/api/auth/validate-invite?token=${t}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setValid(true);
          setUserEmail(data.data.email);
        } else {
          setErrorMessage(data.error?.message || 'Invalid invitation link');
        }
      })
      .catch(() => {
        setErrorMessage('Failed to validate invitation. Please try again.');
      })
      .finally(() => setValidating(false));
  }, [search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allMet || !passwordsMatch) return;

    setSubmitting(true);
    try {
      // Task #420: only carry `preferredLanguage` on the wire when
      // the user actually picked a value. Submitting the AUTO
      // default unconditionally would clobber the stored language
      // of any returning user who's resetting their password
      // without touching the picker (this same page is also the
      // forgot-password landing). The server treats "field absent"
      // as "leave the column alone", so the omission is what
      // preserves their preference.
      const body: { token: string; password: string; preferredLanguage?: string | null } = {
        token,
        password,
      };
      if (languageTouched) {
        body.preferredLanguage = languageSelectionToWire(preferredLanguage);
      }
      const response = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      // Throttle handling (task #418) — mirror the forgot-password
      // and login pages' inline-banner UX. The set-password limiter
      // is per-IP, so a shared kiosk hitting the cap should still
      // see a clear "wait N minutes, your link is fine" message
      // instead of a generic toast that looks like the link broke.
      if (response.status === 429) {
        const retryAfter = parseRetryAfterSeconds(
          response.headers.get('retry-after'),
          response.headers.get('ratelimit-reset'),
        );
        const waitSeconds =
          retryAfter != null && retryAfter > 0
            ? retryAfter
            : DEFAULT_THROTTLE_FALLBACK_SECONDS;
        throttle(waitSeconds);
        return;
      }

      const data = await response.json();
      if (data.success) {
        toast({ title: 'Password set successfully', description: 'You can now log in with your new password.' });
        window.location.href = '/';
      } else {
        toast({ title: 'Error', description: data.error?.message || 'Failed to set password', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Something went wrong. Please try again.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <PageLoadingState message="Validating your invitation..." />
      </div>
    );
  }

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Link Expired or Invalid</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <Button onClick={() => window.location.href = '/login'}>Go to Login</Button>
            <a href="/forgot-password" className="text-sm text-primary hover:underline">
              Request a new password reset link
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ErrorBoundary level="section">
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Set Your Password</CardTitle>
          <CardDescription>
            Create a password for your account ({userEmail}).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
              />
              {confirmPassword && !passwordsMatch && (
                <p className="text-sm text-destructive">Passwords do not match</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="preferredLanguage">Preferred language</Label>
              <Select
                value={preferredLanguage}
                onValueChange={handleLanguageChange}
              >
                <SelectTrigger
                  id="preferredLanguage"
                  data-testid="select-set-password-language"
                >
                  <SelectValue placeholder="Auto (follow my browser)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value={LANGUAGE_AUTO}
                    data-testid="option-set-password-language-auto"
                  >
                    Auto (follow my browser)
                  </SelectItem>
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      data-testid={`option-set-password-language-${opt.value}`}
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used for security and onboarding emails. You can change this
                later in your account settings.
              </p>
            </div>

            {password.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-muted-foreground">Password requirements:</p>
                {requirements.map((req, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {req.met ? (
                      <Check className="size-3.5 text-green-600" />
                    ) : (
                      <X className="size-3.5 text-muted-foreground" />
                    )}
                    <span className={req.met ? 'text-green-600' : 'text-muted-foreground'}>{req.label}</span>
                  </div>
                ))}
              </div>
            )}

            {isThrottled && (
              <Alert variant="destructive" data-testid="alert-set-password-throttled">
                <AlertTriangle className="size-4" />
                <AlertTitle>Too many attempts</AlertTitle>
                <AlertDescription>
                  To protect your account, we've paused password submissions
                  from this device for about{" "}
                  <span data-testid="text-set-password-retry-in">
                    {formatCountdown(remainingSeconds)}
                  </span>
                  . Please try again then — your link is still valid,
                  so you don't need to request a new one.
                </AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!allMet || !passwordsMatch || submitting || isThrottled}
              data-testid="button-set-password-submit"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Setting password…
                </>
              ) : isThrottled ? (
                `Try again in ${formatCountdown(remainingSeconds)}`
              ) : (
                'Set Password & Sign In'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
    </ErrorBoundary>
  );
}
