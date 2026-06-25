'use client';

import { useForm } from '@tanstack/react-form';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { z } from 'zod';
import { GalleryVerticalEnd } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export default function ForgotPasswordPage() {
  const router = useRouter();

  const form = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value.email }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(data.error || 'Failed to send reset link');
        return;
      }

      toast.success('If an account exists, a reset link has been sent');
      router.push('/login');
    },
    validators: {
      onSubmit: ({ value }) => {
        const result = forgotPasswordSchema.safeParse(value);
        if (!result.success) {
          const fieldErrors = result.error.flatten().fieldErrors;
          return {
            fields: {
              email: fieldErrors.email?.[0],
            },
          };
        }
        return undefined;
      },
    },
  });

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <span className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GalleryVerticalEnd className="size-4" />
          </div>
          AgentFork
        </span>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Forgot your password?</CardTitle>
              <CardDescription>
                Enter your email and we&apos;ll send you a reset link
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  form.handleSubmit();
                }}
              >
                <FieldGroup>
                  <form.Field name="email">
                    {(field) => (
                      <Field data-invalid={field.state.meta.errors.length > 0 ? 'true' : undefined}>
                        <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                        <Input
                          id={field.name}
                          name={field.name}
                          type="email"
                          placeholder="you@company.com"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          aria-invalid={!!field.state.meta.errors.length}
                        />
                        <FieldError
                          errors={field.state.meta.errors.map((e) => ({ message: String(e) }))}
                        />
                      </Field>
                    )}
                  </form.Field>
                  <Field>
                    <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                      {([canSubmit, isSubmitting]) => (
                        <Button
                          type="submit"
                          className="w-full"
                          disabled={!canSubmit || isSubmitting}
                        >
                          {isSubmitting ? (
                            <>
                              <Spinner className="mr-2 size-3" />
                              Sending...
                            </>
                          ) : (
                            'Send reset link'
                          )}
                        </Button>
                      )}
                    </form.Subscribe>
                    <FieldDescription className="text-center">
                      Remember your password?{' '}
                      <Link href="/login">Sign in</Link>
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
