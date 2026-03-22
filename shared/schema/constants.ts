import { pgEnum } from "drizzle-orm/pg-core";
import { z } from "zod";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const PAYMENT_MODES = ["weekly", "upfront"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const WeekDay = {
  MONDAY: WEEKDAYS[0],
  TUESDAY: WEEKDAYS[1],
  WEDNESDAY: WEEKDAYS[2],
  THURSDAY: WEEKDAYS[3],
  FRIDAY: WEEKDAYS[4],
  SATURDAY: WEEKDAYS[5],
  SUNDAY: WEEKDAYS[6],
} as const;

export const USER_ROLES = ['system_admin', 'org_admin', 'user'] as const;
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export type UserRole = (typeof USER_ROLES)[number];

export const PAYMENT_STATUSES = ["paid", "pending", "failed", "refunded"] as const;
export const PaymentStatus = {
  PAID: PAYMENT_STATUSES[0],
  PENDING: PAYMENT_STATUSES[1],
  FAILED: PAYMENT_STATUSES[2],
  REFUNDED: PAYMENT_STATUSES[3],
} as const;

export const PAYMENT_TYPES = ["cash", "check", "credit_card"] as const;
export const PaymentType = {
  CASH: PAYMENT_TYPES[0],
  CHECK: PAYMENT_TYPES[1],
  CREDIT_CARD: PAYMENT_TYPES[2],
} as const;

export const dateSchema = z.coerce.date()
  .refine((date) => !isNaN(date.getTime()), {
    message: "Invalid date format",
  })
  .transform((date) => new Date(date.toISOString()));

const timeFormatRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
export const timeSchema = z.union([
  z.literal(""),
  z.string().regex(timeFormatRegex, "Invalid time format. Use HH:MM (24-hour)"),
]);

export const nameSchema = z.string().min(2, "Name must be at least 2 characters");
export const emailSchema = z.string().email("Invalid email address");
export const positiveIntSchema = z.number().int().positive("Must be a positive number");
