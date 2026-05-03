'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createTenantSchema } from '@chatbot/shared/client';
import type { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

type CreateOrgFormValues = z.infer<typeof createTenantSchema>;

export default function CreateOrgPage() {
  const router = useRouter();
  const { status, update } = useSession();
  const [serverError, setServerError] = useState<string | null>(null);
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const slugTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const form = useForm<CreateOrgFormValues>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: { name: '', slug: '' },
    mode: 'onChange',
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const checkSlugAvailability = async (s: string) => {
    if (!s || s.length < 3 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(s)) {
      setSlugStatus('idle');
      return;
    }
    setSlugStatus('checking');
    try {
      const res = await fetch(`/api/tenants/check-slug?slug=${encodeURIComponent(s)}`);
      const data = await res.json();
      const available = data.available;
      setSlugStatus(available ? 'available' : 'taken');
      if (!available) {
        form.setError('slug', { message: 'This slug is already taken. Try another.' });
      } else {
        form.clearErrors('slug');
      }
    } catch {
      setSlugStatus('idle');
    }
  };

  const handleSlugBlur = () => {
    const slug = form.getValues('slug');
    if (slugTimeoutRef.current) clearTimeout(slugTimeoutRef.current);
    slugTimeoutRef.current = setTimeout(() => checkSlugAvailability(slug), 300);
  };

  const onSubmit = async (data: CreateOrgFormValues) => {
    setServerError(null);
    if (slugStatus === 'checking' || slugStatus === 'taken') return;

    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();

      if (res.status === 409) {
        if (json.error?.toLowerCase().includes('slug')) {
          form.setError('slug', { message: 'This slug is already taken. Try another.' });
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

          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <fieldset disabled={form.formState.isSubmitting} className="border-0 p-0 m-0 min-w-0">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Organization name</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Acme Corp"
                    {...form.register('name')}
                    aria-describedby={form.formState.errors.name ? 'name-error' : undefined}
                    className={form.formState.errors.name ? 'border-destructive' : ''}
                  />
                  {form.formState.errors.name && (
                    <p id="name-error" className="text-xs text-destructive mt-1" role="alert">
                      {form.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="slug">Slug</Label>
                  <div className="relative">
                    <Input
                      id="slug"
                      type="text"
                      placeholder="acme-corp"
                      {...form.register('slug', { onBlur: handleSlugBlur })}
                      aria-describedby={
                        form.formState.errors.slug
                          ? 'slug-error'
                          : slugStatus === 'taken'
                            ? 'slug-taken'
                            : 'slug-hint'
                      }
                      className={
                        (form.formState.errors.slug || slugStatus === 'taken'
                          ? 'border-destructive '
                          : '') +
                        (slugStatus === 'available' ? 'border-primary ' : '') +
                        'pr-8'
                      }
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
                  {form.formState.errors.slug && (
                    <p id="slug-error" className="text-xs text-destructive mt-1" role="alert">
                      {form.formState.errors.slug.message}
                    </p>
                  )}
                  {!form.formState.errors.slug && slugStatus === 'available' && (
                    <p className="text-xs text-primary">Slug is available</p>
                  )}
                  {!form.formState.errors.slug && slugStatus === 'taken' && (
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
                    form.formState.isSubmitting ||
                    !form.formState.isValid ||
                    slugStatus === 'checking' ||
                    slugStatus === 'taken'
                  }
                >
                  {form.formState.isSubmitting ? 'Creating organization...' : 'Create organization'}
                </Button>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    </div>
  );
}
