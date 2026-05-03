'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function CreateOrgPage() {
  const router = useRouter();
  const { status, update } = useSession();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');
  const [slugError, setSlugError] = useState('');
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const slugTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const validateName = (value: string) => {
    if (!value.trim()) return 'Organization name is required';
    if (value.length > 100) return 'Organization name must be at most 100 characters';
    return '';
  };

  const validateSlug = (value: string) => {
    if (!value) return 'Slug is required';
    if (value.length < 3) return 'Slug must be at least 3 characters';
    if (value.length > 50) return 'Slug must be at most 50 characters';
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value))
      return 'Slug must be lowercase letters, numbers, or hyphens';
    return '';
  };

  const checkSlugAvailability = useCallback(async (s: string) => {
    if (!s || s.length < 3 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(s)) {
      setSlugStatus('idle');
      return;
    }
    setSlugStatus('checking');
    try {
      const res = await fetch(`/api/tenants/check-slug?slug=${encodeURIComponent(s)}`);
      const data = await res.json();
      setSlugStatus(data.available ? 'available' : 'taken');
    } catch {
      setSlugStatus('idle');
    }
  }, []);

  const handleSlugBlur = () => {
    if (slugTimeoutRef.current) clearTimeout(slugTimeoutRef.current);
    slugTimeoutRef.current = setTimeout(() => checkSlugAvailability(slug), 300);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const nErr = validateName(name);
    const sErr = validateSlug(slug);
    setNameError(nErr);
    setSlugError(sErr);

    if (nErr || sErr || slugStatus === 'checking' || slugStatus === 'taken') return;

    setIsLoading(true);
    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug }),
      });
      const json = await res.json();

      if (res.status === 409) {
        if (json.error?.toLowerCase().includes('slug')) {
          setSlugError('This slug is already taken. Try another.');
          setSlugStatus('taken');
        } else {
          setServerError(json.error ?? 'Failed to create organization. Please try again.');
        }
        return;
      }

      if (!res.ok) {
        setServerError(json.error ?? 'Failed to create organization. Please try again.');
        return;
      }

      await update();
      router.push('/dashboard');
    } catch {
      setServerError('Failed to create organization. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4">
          <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
          <div className="h-10 bg-muted rounded w-full animate-pulse" />
          <div className="h-10 bg-muted rounded w-full animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-card border border-border rounded-xl shadow-sm p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-foreground">Create your organization</h1>
            <p className="text-sm text-muted-foreground mt-1">Set up your workspace to get started</p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <fieldset disabled={isLoading} className="border-0 p-0 m-0 min-w-0">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="name" className="text-sm font-medium">Organization name</label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Acme Corp"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError('');
                    }}
                    aria-describedby={nameError ? 'name-error' : undefined}
                    className={nameError ? 'border-destructive' : ''}
                    disabled={isLoading}
                  />
                  {nameError && (
                    <p id="name-error" className="text-xs text-destructive mt-1" role="alert">
                      {nameError}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label htmlFor="slug" className="text-sm font-medium">Slug</label>
                  <div className="relative">
                    <Input
                      id="slug"
                      type="text"
                      placeholder="acme-corp"
                      value={slug}
                      onChange={(e) => {
                        setSlug(e.target.value);
                        setSlugError('');
                        setSlugStatus('idle');
                      }}
                      onBlur={handleSlugBlur}
                      aria-describedby={
                        slugError
                          ? 'slug-error'
                          : slugStatus === 'taken'
                            ? 'slug-taken'
                            : 'slug-hint'
                      }
                      className={
                        (slugError || slugStatus === 'taken'
                          ? 'border-destructive '
                          : '') +
                        (slugStatus === 'available' ? 'border-primary ' : '') +
                        'pr-8'
                      }
                      disabled={isLoading}
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 text-sm">
                      {slugStatus === 'checking' && (
                        <span className="text-muted-foreground">...</span>
                      )}
                      {slugStatus === 'available' && (
                        <span className="text-primary">✓</span>
                      )}
                      {slugStatus === 'taken' && (
                        <span className="text-destructive">✕</span>
                      )}
                    </div>
                  </div>
                  <p id="slug-hint" className="text-xs text-muted-foreground">
                    Lowercase letters, numbers, and hyphens only. 3-50 characters.
                  </p>
                  {slugError && (
                    <p id="slug-error" className="text-xs text-destructive mt-1" role="alert">
                      {slugError}
                    </p>
                  )}
                  {!slugError && slugStatus === 'available' && (
                    <p className="text-xs text-primary">Slug is available</p>
                  )}
                  {!slugError && slugStatus === 'taken' && (
                    <p id="slug-taken" className="text-xs text-destructive" role="alert">
                      This slug is already taken. Try another.
                    </p>
                  )}
                </div>

                {serverError && (
                  <div className="text-sm text-destructive" role="alert">
                    {serverError}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-11"
                  disabled={
                    isLoading ||
                    slugStatus === 'checking' ||
                    slugStatus === 'taken'
                  }
                >
                  {isLoading ? 'Creating organization...' : 'Create organization'}
                </Button>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    </div>
  );
}
