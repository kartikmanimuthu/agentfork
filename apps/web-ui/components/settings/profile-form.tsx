'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useSession } from 'next-auth/react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { profileUpdateSchema } from '@chatbot/shared/client';
import type { z } from 'zod';

type ProfileFormValues = z.infer<typeof profileUpdateSchema>;

export function ProfileForm() {
  const { data: session } = useSession();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      username: '',
      email: '',
      role: '',
      bio: '',
    },
    mode: 'onChange',
  });

  useEffect(() => {
    if (session?.user) {
      form.setValue('username', (session.user as any).name || '');
      form.setValue('email', (session.user as any).email || '');
      form.setValue('role', (session.user as any).role || 'Member');
    }
  }, [session, form]);

  function onSubmit(data: ProfileFormValues) {
    toast.success('Profile updated successfully');
    console.log('Profile update:', data);
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input id="username" placeholder="Your username" {...form.register('username')} />
        {form.formState.errors.username && (
          <p className="text-sm text-destructive">{form.formState.errors.username.message}</p>
        )}
        <p className="text-sm text-muted-foreground">This is your public display name.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" placeholder="Your email" {...form.register('email')} disabled />
        <p className="text-sm text-muted-foreground">Managed by your identity provider.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="role">Role</Label>
        <Input id="role" {...form.register('role')} disabled />
        <p className="text-sm text-muted-foreground">Your assigned role in the organization.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          placeholder="Tell us a little bit about yourself"
          className="resize-none"
          {...form.register('bio')}
        />
        {form.formState.errors.bio && (
          <p className="text-sm text-destructive">{form.formState.errors.bio.message}</p>
        )}
      </div>

      <Button type="submit">Update profile</Button>
    </form>
  );
}
