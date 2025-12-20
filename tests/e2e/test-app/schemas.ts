import { z } from 'zod';

// Email schema - must be a valid email format
export const emailSchema = z.string().email();
export type Email = z.infer<typeof emailSchema>;

// UserId schema - must be a positive integer
export const userIdSchema = z.number().int().positive();
export type UserId = z.infer<typeof userIdSchema>;
