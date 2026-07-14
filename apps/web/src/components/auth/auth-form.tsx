'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { Magnetic } from '@/components/motion';
import {
  consumeRateLimit,
  resetRateLimit,
  describeWait,
  RATE_LIMITS,
} from '@/lib/auth/client-rate-limit';
import { GoogleIcon, MicrosoftIcon } from './icons';

type Mode = 'signin' | 'signup';
type Method = 'password' | 'magic';
type OAuthProvider = 'google' | 'azure';

const MIN_PASSWORD = 8;

export interface AuthFormProps {
  mode: Mode;
  /** Where to land after a successful sign-in. */
  next: string;
  /** Selected plan (signup only) — forwarded to onboarding via auth metadata. */
  plan?: string | null;
  /** Error surfaced from a redirect (e.g. failed OAuth callback). */
  initialError?: string | null;
}

interface Notice {
  title: string;
  body: React.ReactNode;
}

export function AuthForm({ mode, next, plan, initialError }: AuthFormProps) {
  const isSignup = mode === 'signup';

  const [method, setMethod] = useState<Method>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [orgName, setOrgName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const callbackUrl = (dest: string) =>
    `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(dest)}`;

  const signupMeta = () => ({
    intended_org_name: orgName.trim(),
    intended_plan: plan ?? 'free',
  });

  async function handleOAuth(provider: OAuthProvider) {
    setError(null);
    setOauthBusy(provider);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: callbackUrl(next),
          // Microsoft (Entra) needs these explicitly to return an email.
          ...(provider === 'azure' ? { scopes: 'email openid profile' } : {}),
        },
      });
      // On success the browser redirects away; only reached on error.
      if (error) {
        setError(friendlyError(error.message));
        setOauthBusy(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      setOauthBusy(null);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (isSignup && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    const limit = consumeRateLimit('password', email, RATE_LIMITS.password);
    if (!limit.ok) {
      setError(
        `Too many attempts. Please wait ${describeWait(limit.retryAfterSeconds)} and try again.`,
      );
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();

      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: signupMeta(), emailRedirectTo: callbackUrl(next) },
        });
        if (error) {
          setError(friendlyError(error.message));
          return;
        }
        // Email confirmation on → no session yet; user must click the link.
        if (!data.session) {
          resetRateLimit('password', email);
          setNotice({
            title: 'Confirm your email',
            body: (
              <>
                We sent a confirmation link to <span className="text-ink font-medium">{email}</span>
                .
                <br />
                Click it to finish creating your workspace.
              </>
            ),
          });
          return;
        }
        // Confirmation disabled → already signed in.
        resetRateLimit('password', email);
        window.location.assign(next);
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(friendlyError(error.message));
        return;
      }
      resetRateLimit('password', email);
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMagicSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const limit = consumeRateLimit('emailLink', email, RATE_LIMITS.emailLink);
    if (!limit.ok) {
      setError(
        `Too many link requests. Please wait ${describeWait(limit.retryAfterSeconds)} and try again.`,
      );
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: callbackUrl(next),
          ...(isSignup ? { data: signupMeta() } : {}),
        },
      });
      if (error) {
        setError(friendlyError(error.message));
        return;
      }
      setNotice({
        title: 'Check your inbox',
        body: (
          <>
            We sent a single-use link to <span className="text-ink font-medium">{email}</span>.
            <br />
            It expires in 1 hour.
          </>
        ),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't send the link.");
    } finally {
      setLoading(false);
    }
  }

  if (notice) {
    return (
      <div className="space-y-5 py-2 text-center">
        <div className="bg-accent/10 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-accent">
            <path
              d="M3 6l8 6 8-6M3 6v10a1 1 0 001 1h14a1 1 0 001-1V6M3 6a1 1 0 011-1h14a1 1 0 011 1"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 className="text-ink text-2xl font-semibold tracking-tight">{notice.title}</h2>
        <p className="text-ink-faded text-[14px] leading-relaxed">{notice.body}</p>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setError(null);
          }}
          className="text-accent text-[13px] font-medium underline-offset-4 hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  const busy = loading || oauthBusy !== null;

  return (
    <div className="space-y-5">
      {/* Social sign-in */}
      <div className="grid gap-2.5">
        <OAuthButton
          onClick={() => handleOAuth('google')}
          disabled={busy}
          busy={oauthBusy === 'google'}
          icon={<GoogleIcon />}
          label="Continue with Google"
        />
        <OAuthButton
          onClick={() => handleOAuth('azure')}
          disabled={busy}
          busy={oauthBusy === 'azure'}
          icon={<MicrosoftIcon />}
          label="Continue with Microsoft"
        />
      </div>

      <div className="text-ink-mute flex items-center gap-3 text-[11px] uppercase tracking-[0.2em]">
        <span className="bg-hairline h-px flex-1" />
        <span>or</span>
        <span className="bg-hairline h-px flex-1" />
      </div>

      {method === 'password' ? (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {isSignup && (
            <Field label="Workspace name" hint="You can change this later.">
              <input
                type="text"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Research"
                autoComplete="organization"
                className={inputClass}
              />
            </Field>
          )}

          <Field label={isSignup ? 'Work email' : 'Email'}>
            <input
              type="email"
              required
              autoFocus={!isSignup}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              className={inputClass}
            />
          </Field>

          <Field
            label="Password"
            trailing={
              !isSignup ? (
                <Link
                  href="/forgot-password"
                  className="text-accent text-[12px] font-medium underline-offset-4 hover:underline"
                >
                  Forgot?
                </Link>
              ) : undefined
            }
          >
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={MIN_PASSWORD}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? 'At least 8 characters' : '••••••••'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                className={`${inputClass} pr-16`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-ink-faded hover:text-ink absolute inset-y-0 right-3 my-auto h-fit text-[12px] font-medium"
                tabIndex={-1}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          {isSignup && (
            <Field label="Confirm password">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={MIN_PASSWORD}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className={inputClass}
              />
            </Field>
          )}

          <SubmitButton loading={loading}>{isSignup ? 'Create workspace' : 'Sign in'}</SubmitButton>

          {error && <ErrorNote>{error}</ErrorNote>}
        </form>
      ) : (
        <form onSubmit={handleMagicSubmit} className="space-y-4">
          {isSignup && (
            <Field label="Workspace name" hint="You can change this later.">
              <input
                type="text"
                required
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Research"
                autoComplete="organization"
                className={inputClass}
              />
            </Field>
          )}
          <Field label={isSignup ? 'Work email' : 'Email'}>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              className={inputClass}
            />
          </Field>

          <SubmitButton loading={loading}>
            {isSignup ? 'Email me a sign-up link' : 'Email me a sign-in link'}
          </SubmitButton>

          {error && <ErrorNote>{error}</ErrorNote>}
        </form>
      )}

      {/* Method toggle */}
      <div className="text-ink-faded text-center text-[13px]">
        {method === 'password' ? (
          <button
            type="button"
            onClick={() => {
              setMethod('magic');
              setError(null);
            }}
            className="text-ink font-medium underline-offset-4 hover:underline"
          >
            Email me a link instead
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setMethod('password');
              setError(null);
            }}
            className="text-ink font-medium underline-offset-4 hover:underline"
          >
            Use a password instead
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- small building blocks (kept local to match page styling) ---------- */

const inputClass =
  'border-hairline-strong bg-paper text-ink placeholder:text-ink-mute focus:border-accent block h-11 w-full rounded-xl border px-4 text-[15px] transition-colors focus:outline-none';

function Field({
  label,
  hint,
  trailing,
  children,
}: {
  label: string;
  hint?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between">
        <span className="text-ink text-[13px] font-medium">{label}</span>
        {trailing}
      </span>
      <div className="focus-ring mt-1.5 rounded-xl">{children}</div>
      {hint && <span className="text-ink-faded mt-1.5 block text-[12px]">{hint}</span>}
    </label>
  );
}

function OAuthButton({
  onClick,
  disabled,
  busy,
  icon,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="border-hairline-strong bg-paper text-ink hover:bg-paper-soft flex h-11 w-full items-center justify-center gap-2.5 rounded-full border text-[14px] font-medium transition-colors disabled:opacity-60"
    >
      {busy ? <Spinner /> : icon}
      {busy ? 'Redirecting…' : label}
    </button>
  );
}

function SubmitButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <Magnetic strength={5}>
      <button
        type="submit"
        disabled={loading}
        className="bg-ink text-paper shadow-blue hover:shadow-blue-lg group relative flex h-11 w-full items-center justify-center gap-1 overflow-hidden rounded-full text-[14px] font-medium transition-shadow disabled:opacity-60"
      >
        <span className="from-accent-deep via-accent to-accent-glow absolute inset-0 -translate-x-full bg-gradient-to-r transition-transform duration-500 group-hover:translate-x-0" />
        <span className="relative flex items-center gap-1.5">
          {loading ? 'One moment…' : children}
          {!loading && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              className="transition-transform group-hover:translate-x-0.5"
            >
              <path
                d="M3 7h8m0 0L7 3m4 4l-4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </button>
    </Magnetic>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">
      {children}
    </p>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="animate-spin" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
        fill="none"
      />
      <path
        d="M14 8a6 6 0 00-6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Maps raw Supabase auth errors to something a human wants to read. */
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials'))
    return "That email and password don't match. Try again, or reset your password.";
  if (m.includes('email not confirmed'))
    return 'Please confirm your email first — check your inbox for the link we sent.';
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'An account with this email already exists. Try signing in instead.';
  if (m.includes('password should be') || m.includes('password is too'))
    return `Password is too weak. Use at least ${MIN_PASSWORD} characters.`;
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts. Please wait a moment and try again.';
  if (m.includes('provider is not enabled'))
    return 'That sign-in method is not enabled yet. Try another option.';
  return message;
}
