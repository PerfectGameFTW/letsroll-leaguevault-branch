import { z } from "zod";

export const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .max(100, "Password must be less than 100 characters")
  .refine(p => /[A-Z]/.test(p), "Password must contain at least one uppercase letter")
  .refine(p => /[a-z]/.test(p), "Password must contain at least one lowercase letter")
  .refine(p => /[0-9]/.test(p), "Password must contain at least one number")
  .refine(p => /[!@#$%^&*]/.test(p), "Password must contain at least one special character (!@#$%^&*)");
