import { z } from 'zod';

export const emailSchema = z.string().email('Please enter a valid email address');
export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters');

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const profileUpdateSchema = z.object({
  username: z.string().min(2, 'Username must be at least 2 characters').max(30),
  email: emailSchema,
  role: z.string().min(1),
  bio: z.string().max(160).optional(),
});
