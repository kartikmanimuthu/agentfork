import { z } from 'zod';

export const createInvitationSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.string().min(1, 'Role is required'),
});

export const invitationIdQuerySchema = z.object({
  id: z.string().min(1, 'Invitation ID is required'),
});
