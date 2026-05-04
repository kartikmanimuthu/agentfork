'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useForm } from '@tanstack/react-form';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const orgSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(100, 'Must be at most 100 characters'),
  slug: z
    .string()
    .min(3, 'Slug must be at least 3 characters')
    .max(50, 'Must be at most 50 characters')
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      'Slug must be lowercase letters, numbers, or hyphens'
    ),
});

export default function CreateOrgPage() {
  const router = useRouter();
  const { status, update } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const slugTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

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

  const form = useForm({
    defaultValues: { name: '', slug: '' },
    onSubmit: async ({ value }) => {
      if (slugStatus === 'checking' || slugStatus === 'taken') {
        toast.error('Please wait for slug validation or choose a different slug');
        return;
      }

      setIsLoading(true);
      setServerError(null);

      try {
        const res = await fetch('/api/tenants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: value.name.trim(), slug: value.slug }),
        });
        const json = await res.json();

        if (res.status === 409) {
          if (json.error?.toLowerCase().includes('slug')) {
            setSlugStatus('taken');
            toast.error('This slug is already taken. Try another.');
          } else {
            setServerError(json.error ?? 'Failed to create organization.');
            toast.error(json.error ?? 'Failed to create organization.');
          }
          return;
        }

        if (!res.ok) {
          setServerError(json.error ?? 'Failed to create organization.');
          toast.error(json.error ?? 'Failed to create organization.');
          return;
        }

        toast.success('Organization created!');
        await update();
        router.push('/dashboard');
      } catch {
        setServerError('Failed to create organization. Please try again.');
        toast.error('Failed to create organization. Please try again.');
      } finally {
        setIsLoading(false);
      }
    },
    validators: {
      onSubmit: ({ value }) => {
        const result = orgSchema.safeParse(value);
        if (!result.success) {
          const fieldErrors = result.error.flatten().fieldErrors;
          return {
            fields: {
              name: fieldErrors.name?.[0],
              slug: fieldErrors.slug?.[0],
            },
          };
        }
        return undefined;
      },
    },
  });

  const handleSlugBlur = () => {
    if (slugTimeoutRef.current) clearTimeout(slugTimeoutRef.current);
    const slug = form.getFieldValue('slug');
    slugTimeoutRef.current = setTimeout(() => checkSlugAvailability(slug), 300);
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-background via-muted/30 to-background" />
      <motion.div
        className="absolute left-1/2 top-0 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]"
        animate={{ y: [0, 40, 0], opacity: [0.4, 0.6, 0.4] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-sm"
      >
        <Card>
          <CardHeader className="text-center">
            <CardTitle>Create your organization</CardTitle>
            <CardDescription>Set up your workspace to get started</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              className="space-y-4"
            >
              <form.Field name="name">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Organization name</Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="text"
                      placeholder="Acme Corp"
                      value={field.state.value}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                        if (field.state.meta.errors.length) field.setMeta((prev) => ({ ...prev, errors: [] }));
                      }}
                      onBlur={field.handleBlur}
                      disabled={isLoading}
                      aria-invalid={!!field.state.meta.errors.length}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="slug">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Slug</Label>
                    <div className="relative">
                      <Input
                        id={field.name}
                        name={field.name}
                        type="text"
                        placeholder="acme-corp"
                        value={field.state.value}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                          if (field.state.meta.errors.length) field.setMeta((prev) => ({ ...prev, errors: [] }));
                          setSlugStatus('idle');
                        }}
                        onBlur={() => {
                          field.handleBlur();
                          handleSlugBlur();
                        }}
                        disabled={isLoading}
                        aria-describedby="slug-hint"
                        aria-invalid={!!field.state.meta.errors.length || slugStatus === 'taken'}
                        className={
                          (field.state.meta.errors.length || slugStatus === 'taken' ? 'border-destructive ' : '') +
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
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-xs text-destructive">{field.state.meta.errors[0]}</p>
                    )}
                    {!field.state.meta.errors.length && slugStatus === 'available' && (
                      <p className="text-xs text-primary">Slug is available</p>
                    )}
                    {!field.state.meta.errors.length && slugStatus === 'taken' && (
                      <p className="text-xs text-destructive">This slug is already taken. Try another.</p>
                    )}
                  </div>
                )}
              </form.Field>

              {serverError && (
                <div className="text-sm text-destructive" role="alert">{serverError}</div>
              )}

              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit, isSubmitting]) => (
                  <Button
                    type="submit"
                    className="w-full h-11"
                    disabled={
                      !canSubmit ||
                      isLoading ||
                      isSubmitting ||
                      slugStatus === 'checking' ||
                      slugStatus === 'taken'
                    }
                  >
                    {isLoading || isSubmitting ? (
                      <>
                        <Spinner className="size-3 mr-2" />
                        Creating organization...
                      </>
                    ) : (
                      'Create organization'
                    )}
                  </Button>
                )}
              </form.Subscribe>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
