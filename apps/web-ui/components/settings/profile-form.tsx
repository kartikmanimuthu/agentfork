'use client';

import { useForm } from '@tanstack/react-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useSession } from 'next-auth/react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Save, User, Mail, FileText } from 'lucide-react';

const profileFormSchema = z.object({
  displayName: z.string().min(2, 'Display name must be at least 2 characters.').max(30),
  email: z.string().email(),
  bio: z.string().max(160).optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function ProfileForm() {
  const { data: session } = useSession();

  const form = useForm({
    defaultValues: {
      displayName: '',
      email: '',
      bio: '',
    } as ProfileFormValues,
    validators: {
      onChange: profileFormSchema,
    },
    onSubmit: ({ value }) => {
      toast.success('Profile updated successfully');
      console.log('Profile update:', value);
    },
  });

  useEffect(() => {
    if (session?.user) {
      const user = session.user as any;
      form.setFieldValue('displayName', user.name || '');
      form.setFieldValue('email', user.email || '');
    }
  }, [session, form]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-6"
    >
      {/* Display Name */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Display Name</h3>
        </div>
        <form.Field
          name="displayName"
          children={(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Name</Label>
              <Input
                id={field.name}
                name={field.name}
                placeholder="Your display name"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                aria-invalid={!field.state.meta.isValid}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-sm text-destructive">{field.state.meta.errors.join(', ')}</p>
              )}
              <p className="text-xs text-muted-foreground">This is your public display name.</p>
            </div>
          )}
        />
      </div>

      <Separator />

      {/* Email */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Email Address</h3>
        </div>
        <form.Field
          name="email"
          children={(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Email</Label>
              <Input
                id={field.name}
                name={field.name}
                placeholder="Your email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                disabled
              />
              <p className="text-xs text-muted-foreground">Managed by your identity provider.</p>
            </div>
          )}
        />
      </div>

      <Separator />

      {/* Bio */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Bio</h3>
        </div>
        <form.Field
          name="bio"
          children={(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>About</Label>
              <Textarea
                id={field.name}
                name={field.name}
                placeholder="Tell us a little bit about yourself"
                className="resize-none min-h-[100px]"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                aria-invalid={!field.state.meta.isValid}
              />
              {field.state.meta.errors.length > 0 && (
                <p className="text-sm text-destructive">{field.state.meta.errors.join(', ')}</p>
              )}
              <p className="text-xs text-muted-foreground">Maximum 160 characters.</p>
            </div>
          )}
        />
      </div>

      <div className="pt-2">
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting, state.isDirty]}
          children={([canSubmit, isSubmitting, isDirty]) => (
            <Button type="submit" disabled={!canSubmit || !isSubmitting}>
              <Save className="mr-2 h-4 w-4" />
              {isSubmitting ? 'Updating...' : 'Update Profile'}
            </Button>
          )}
        />
      </div>
    </form>
  );
}
