import { pgTable, text, serial, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Update the enum definitions to use const arrays for Zod
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WeekDay = {
  MONDAY: WEEKDAYS[0],
  TUESDAY: WEEKDAYS[1],
  WEDNESDAY: WEEKDAYS[2],
  THURSDAY: WEEKDAYS[3],
  FRIDAY: WEEKDAYS[4],
  SATURDAY: WEEKDAYS[5],
  SUNDAY: WEEKDAYS[6],
} as const;

const PAYMENT_STATUSES = ["paid", "pending", "failed"] as const;
export const PaymentStatus = {
  PAID: PAYMENT_STATUSES[0],
  PENDING: PAYMENT_STATUSES[1],
  FAILED: PAYMENT_STATUSES[2],
} as const;

const PAYMENT_TYPES = ["cash", "check", "credit_card"] as const;
export const PaymentType = {
  CASH: PAYMENT_TYPES[0],
  CHECK: PAYMENT_TYPES[1],
  CREDIT_CARD: PAYMENT_TYPES[2],
} as const;

// Date validation schemas
const dateSchema = z.coerce.date()
  .refine((date) => !isNaN(date.getTime()), {
    message: "Invalid date format",
  })
  .transform((date) => new Date(date.toISOString())); // Normalize to UTC

const timeFormatRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
const timeSchema = z.string().regex(timeFormatRegex, "Invalid time format. Use HH:MM (24-hour)");

// Common validation rules
const nameSchema = z.string().min(2, "Name must be at least 2 characters");
const emailSchema = z.string().email("Invalid email address");
const positiveIntSchema = z.number().int().positive("Must be a positive number");

// Database table definitions
export const leagues = pgTable("leagues", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  seasonStart: timestamp("season_start", { mode: "date" }).notNull(),
  seasonEnd: timestamp("season_end", { mode: "date" }).notNull(),
  weekDay: text("week_day", { enum: WEEKDAYS }).notNull(),
  weeklyFee: integer("weekly_fee").notNull().default(2000),
  practiceStartTime: text("practice_start_time"),
  competitionStartTime: text("competition_start_time"),
  qubicaId: text("qubica_id").unique(),
  organizationId: integer("organization_id").references(() => organizations.id),
}, (table) => ({
  activeNameIdx: index("leagues_active_name_idx").on(table.active, table.name),
  seasonIdx: index("leagues_season_idx").on(table.seasonStart, table.seasonEnd),
  organizationIdx: index("leagues_organization_idx").on(table.organizationId)
}));

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  number: integer("number").notNull(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
}, (table) => ({
  leagueNumberIdx: uniqueIndex("teams_league_number_idx").on(table.leagueId, table.number),
}));

export const bowlers = pgTable("bowlers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
  squareCustomerId: text("square_customer_id"),
  qubicaId: text("qubica_id").unique(),
});

export const bowlerLeagues = pgTable("bowler_leagues", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  active: boolean("active").notNull().default(true),
  order: integer("order").notNull().default(0),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (table) => ({
  bowlerIdx: index().on(table.bowlerId),
  leagueIdx: index().on(table.leagueId),
  teamIdx: index().on(table.teamId),
  orderIdx: index().on(table.teamId, table.leagueId, table.order),
  // Unique composite index for active bowler-league-team combinations
  activeBowlerIdx: index("bowler_leagues_active_unique_idx").on(
    table.bowlerId,
    table.leagueId,
    table.teamId,
    table.active
  ),
}));

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  amount: integer("amount").notNull(), // Store in cents
  weekOf: timestamp("week_of").notNull(),
  status: text("status", { enum: PAYMENT_STATUSES }).notNull().default('paid'),
  type: text("type", { enum: PAYMENT_TYPES }).notNull(),
  checkNumber: text("check_number"),
  squarePaymentId: text("square_payment_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  bowlerIdx: index("payments_bowler_idx").on(table.bowlerId),
  leagueIdx: index("payments_league_idx").on(table.leagueId),
  weekOfIdx: index("payments_week_of_idx").on(table.weekOf),
}));

// Add new tables after the existing scores table
export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  weekNumber: integer("week_number").notNull(),
  gameNumber: integer("game_number").notNull(), // 1, 2, or 3
  date: timestamp("date", { mode: "string" }).notNull(),
}, (table) => ({
  leagueGameIdx: index("league_game_idx").on(table.leagueId, table.weekNumber, table.gameNumber),
  dateIdx: index("game_date_idx").on(table.date),
}));

export const scores = pgTable("scores", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  score: integer("score").notNull(),
  handicap: integer("handicap").notNull(),
  average: integer("average").notNull(),
  position: integer("position").notNull(),
  isVacant: boolean("is_vacant").notNull().default(false),
  isAbsent: boolean("is_absent").notNull().default(false),
  isSub: boolean("is_sub").notNull().default(false),
  laneNumber: integer("lane_number").notNull(),
  frames: text().array().notNull().default(sql`'{}'`),
  splits: text().array().notNull().default(sql`'{}'`),
  notes: text().array().notNull().default(sql`'{}'`),
}, (table) => ({
  gameScoreIdx: index("game_score_idx").on(table.gameId, table.teamId, table.position),
  bowlerScoreIdx: index("bowler_score_idx").on(table.bowlerId),
  laneNumberIdx: index("lane_number_idx").on(table.laneNumber),
}));

// Update user schema to include name, phone fields, admin flag, and organization
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  bowlerId: integer("bowler_id").references(() => bowlers.id),
  name: text("name").notNull(),
  phone: text("phone"),
  avatar: text("avatar"),
  isAdmin: boolean("is_admin").notNull().default(false),
  isOrganizationAdmin: boolean("is_organization_admin").notNull().default(false),
  organizationId: integer("organization_id").references(() => organizations.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  organizationIdx: index("users_organization_idx").on(table.organizationId),
  bowlerIdx: index("users_bowler_idx").on(table.bowlerId),
}));

// Organization table
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  phone: text("phone"),
  email: text("email"),
  logo: text("logo"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex("organization_slug_idx").on(table.slug),
}));

// Add after the existing payment table definition
export const paymentSchedules = pgTable("payment_schedules", {
  id: serial("id").primaryKey(),
  bowlerId: integer("bowler_id")
    .notNull()
    .references(() => bowlers.id, { onDelete: 'cascade' }),
  leagueId: integer("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: 'cascade' }),
  frequency: text("frequency", { enum: ["weekly", "monthly"] }).notNull(),
  amount: integer("amount").notNull(), // Store in cents
  nextPaymentDate: timestamp("next_payment_date").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastPaymentDate: timestamp("last_payment_date"),
  squareCardId: text("square_card_id").notNull(),
}, (table) => ({
  bowlerScheduleIdx: index("bowler_schedule_idx").on(table.bowlerId, table.leagueId),
  nextPaymentIdx: index("next_payment_idx").on(table.nextPaymentDate),
  activeIdx: index("active_schedule_idx").on(table.active),
}));

// Relations
export const organizationRelations = relations(organizations, ({ many }) => ({
  leagues: many(leagues),
  users: many(users),
}));

export const leagueRelations = relations(leagues, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [leagues.organizationId],
    references: [organizations.id],
  }),
  teams: many(teams),
  bowlerLeagues: many(bowlerLeagues),
  payments: many(payments),
}));

export const teamRelations = relations(teams, ({ one, many }) => ({
  league: one(leagues, {
    fields: [teams.leagueId],
    references: [leagues.id],
  }),
  bowlerLeagues: many(bowlerLeagues),
}));

export const bowlerRelations = relations(bowlers, ({ many }) => ({
  bowlerLeagues: many(bowlerLeagues),
  payments: many(payments),
  users: many(users), // Add this line to existing bowler relations
}));

export const bowlerLeagueRelations = relations(bowlerLeagues, ({ one }) => ({
  bowler: one(bowlers, {
    fields: [bowlerLeagues.bowlerId],
    references: [bowlers.id],
  }),
  league: one(leagues, {
    fields: [bowlerLeagues.leagueId],
    references: [leagues.id],
  }),
  team: one(teams, {
    fields: [bowlerLeagues.teamId],
    references: [teams.id],
  }),
}));

// Add relations for the new tables
export const gameRelations = relations(games, ({ one, many }) => ({
  league: one(leagues, {
    fields: [games.leagueId],
    references: [leagues.id],
  }),
  scores: many(scores),
}));

export const scoreRelations = relations(scores, ({ one }) => ({
  game: one(games, {
    fields: [scores.gameId],
    references: [games.id],
  }),
  bowler: one(bowlers, {
    fields: [scores.bowlerId],
    references: [bowlers.id],
  }),
  team: one(teams, {
    fields: [scores.teamId],
    references: [teams.id],
  }),
}));

// Add to relations
export const paymentScheduleRelations = relations(paymentSchedules, ({ one }) => ({
  bowler: one(bowlers, {
    fields: [paymentSchedules.bowlerId],
    references: [bowlers.id],
  }),
  league: one(leagues, {
    fields: [paymentSchedules.leagueId],
    references: [leagues.id],
  }),
}));


// Add user relations after existing relations
export const userRelations = relations(users, ({ one }) => ({
  bowler: one(bowlers, {
    fields: [users.bowlerId],
    references: [bowlers.id],
  }),
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
}));

// Validation schemas
// Base schemas using drizzle-zod
const baseBowlerSchema = createInsertSchema(bowlers);
const baseLeagueSchema = createInsertSchema(leagues);
const baseTeamSchema = createInsertSchema(teams);
const baseBowlerLeagueSchema = createInsertSchema(bowlerLeagues);
const basePaymentSchema = createInsertSchema(payments);
const baseGameSchema = createInsertSchema(games);
const baseScoreSchema = createInsertSchema(scores);
// Add validation schemas after existing schemas
const baseUserSchema = createInsertSchema(users);
const baseOrganizationSchema = createInsertSchema(organizations);

// Add validation schemas
const basePaymentScheduleSchema = createInsertSchema(paymentSchedules);

// Enhanced insert schemas with additional validation
export const insertBowlerSchema = baseBowlerSchema.extend({
  name: nameSchema,
  email: emailSchema.optional(),
  active: z.boolean().default(true),
  order: z.number().min(0).default(0),
  squareCustomerId: z.string().nullable().optional(),
  qubicaId: z.string().nullable().optional(),
}).omit({ id: true });

export const insertLeagueSchema = baseLeagueSchema.extend({
  name: nameSchema,
  description: z.string().nullable().optional(),
  active: z.boolean().default(true),
  seasonStart: dateSchema,
  seasonEnd: dateSchema,
  weekDay: z.enum(WEEKDAYS),
  weeklyFee: positiveIntSchema.default(2000),
  practiceStartTime: timeSchema.optional(),
  competitionStartTime: timeSchema.optional(),
  qubicaId: z.string().nullable().optional(),
}).omit({ id: true })
  .refine(
    (data) => data.seasonEnd > data.seasonStart,
    "Season end date must be after season start date"
  );

export const insertTeamSchema = baseTeamSchema.extend({
  name: nameSchema,
  number: positiveIntSchema,
  leagueId: positiveIntSchema,
  active: z.boolean().default(true),
}).omit({ id: true });

export const insertBowlerLeagueSchema = baseBowlerLeagueSchema.extend({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  teamId: positiveIntSchema,
  active: z.boolean().default(true),
  order: z.number().min(0).default(0),
}).omit({ id: true });

export const insertPaymentSchema = basePaymentSchema.extend({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  amount: positiveIntSchema,
  weekOf: dateSchema,
  status: z.enum(PAYMENT_STATUSES).default("paid"),
  type: z.enum(PAYMENT_TYPES),
  checkNumber: z.string().optional(),
  squarePaymentId: z.string().optional(),
  notes: z.string().optional(),
  storeCard: z.boolean().optional(), // For client-side storage of card details (not stored in DB)
}).omit({ id: true, createdAt: true });

// Update the insert schemas with stronger validation
export const insertGameSchema = baseGameSchema.extend({
  leagueId: positiveIntSchema,
  weekNumber: positiveIntSchema,
  gameNumber: z.number().int().min(1).max(3),
  date: dateSchema,
}).omit({ id: true });

// Frame validation regex for standard bowling notation
const frameRegex = /^([0-9FX]|[0-9]\/|-)+$/;

export const insertScoreSchema = baseScoreSchema.extend({
  gameId: positiveIntSchema,
  bowlerId: positiveIntSchema,
  teamId: positiveIntSchema,
  score: z.number().int().min(0).max(300),
  handicap: z.number().int().min(0).max(300),
  average: z.number().int().min(0).max(300),
  position: z.number().int().min(1).max(4),
  isVacant: z.boolean().default(false),
  isAbsent: z.boolean().default(false),
  isSub: z.boolean().default(false),
  laneNumber: positiveIntSchema,
  frames: z.array(z.string().regex(frameRegex, "Invalid frame notation")).default([]),
  splits: z.array(z.string().regex(/^[0-9-]+$/, "Invalid split notation")).default([]),
  notes: z.array(z.string().max(500)).default([]),
}).omit({ id: true });

// Update the insertUserSchema definition
export const insertUserSchema = baseUserSchema.extend({
  email: emailSchema,
  name: nameSchema,
  phone: z.string().optional(),
  isAdmin: z.boolean().optional().default(false),
  isOrganizationAdmin: z.boolean().optional().default(false),
  organizationId: z.number().nullable().optional(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be less than 100 characters")
    .refine(
      (password) => /[A-Z]/.test(password),
      "Password must contain at least one uppercase letter"
    )
    .refine(
      (password) => /[a-z]/.test(password),
      "Password must contain at least one lowercase letter"
    )
    .refine(
      (password) => /[0-9]/.test(password),
      "Password must contain at least one number"
    )
    .refine(
      (password) => /[!@#$%^&*]/.test(password),
      "Password must contain at least one special character (!@#$%^&*)"
    )
    .refine(
      (password) => {
        const commonPasswords = [
          "Password123!", "Admin123!", "Test123!",
          "Welcome123!", "Abc123456!", "Qwerty123!"
        ];
        return !commonPasswords.includes(password);
      },
      "This password is too common. Please choose a more unique password"
    ),
  bowlerId: z.number().nullable().optional(),
}).omit({ id: true, createdAt: true });

export const insertPaymentScheduleSchema = basePaymentScheduleSchema.extend({
  bowlerId: positiveIntSchema,
  leagueId: positiveIntSchema,
  frequency: z.enum(["weekly", "monthly"]),
  amount: positiveIntSchema,
  nextPaymentDate: dateSchema,
  active: z.boolean().default(true),
  squareCardId: z.string(),
}).omit({ id: true, createdAt: true, lastPaymentDate: true });


// Export partial schemas for updates
export const partialBowlerSchema = z.object(baseBowlerSchema.shape).partial();
export const partialLeagueSchema = z.object({
  name: nameSchema,
  description: z.string().nullable(),
  active: z.boolean(),
  seasonStart: dateSchema,
  seasonEnd: dateSchema,
  weekDay: z.enum(WEEKDAYS),
  weeklyFee: positiveIntSchema,
  practiceStartTime: timeSchema,
  competitionStartTime: timeSchema,
  qubicaId: z.string().nullable(),
}).partial().refine(
  (data) => {
    if (data.seasonStart && data.seasonEnd) {
      return data.seasonEnd > data.seasonStart;
    }
    return true;
  },
  "Season end date must be after season start date"
);
export const partialTeamSchema = z.object(baseTeamSchema.shape).partial();
export const partialBowlerLeagueSchema = z.object(baseBowlerLeagueSchema.shape).partial();
export const partialPaymentSchema = z.object(basePaymentSchema.shape).partial();
export const partialGameSchema = z.object(baseGameSchema.shape).partial();
export const partialScoreSchema = z.object(baseScoreSchema.shape).partial();
export const partialPaymentScheduleSchema = z.object(basePaymentScheduleSchema.shape).partial();
export const partialOrganizationSchema = z.object(baseOrganizationSchema.shape).partial();

// Organization schema with validation
export const insertOrganizationSchema = baseOrganizationSchema.extend({
  name: nameSchema,
  slug: z.string().min(2, "Slug must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Slug must contain only lowercase letters, numbers, and hyphens"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  phone: z.string().optional(),
  email: emailSchema.optional(),
  logo: z.string().optional(),
  active: z.boolean().default(true),
}).omit({ id: true, createdAt: true });

// Type exports
export type League = typeof leagues.$inferSelect;
export type InsertLeague = z.infer<typeof insertLeagueSchema>;

export type Team = typeof teams.$inferSelect;
export type InsertTeam = z.infer<typeof insertTeamSchema>;

export type Bowler = typeof bowlers.$inferSelect;
export type InsertBowler = z.infer<typeof insertBowlerSchema>;

export type BowlerLeague = typeof bowlerLeagues.$inferSelect;
export type InsertBowlerLeague = z.infer<typeof insertBowlerLeagueSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

// Type exports for the new tables
export type Game = typeof games.$inferSelect;
export type InsertGame = z.infer<typeof insertGameSchema>;

export type Score = typeof scores.$inferSelect;
export type InsertScore = z.infer<typeof insertScoreSchema>;

// Add type exports after existing types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type PaymentSchedule = typeof paymentSchedules.$inferSelect;
export type InsertPaymentSchedule = z.infer<typeof insertPaymentScheduleSchema>;

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;


// API response types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export interface ApiListResponse<T> {
  success: boolean;
  data: T[];
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  error?: {
    message: string;
    code?: string;
  };
}

export interface SeriesWithStats {
  id: number;
  leagueId: number;
  weekNumber: number;
  seriesDate: Date;
  isComplete: boolean;
  stats: WeeklyStat[];
}

export interface WeeklyStatWithBowler extends WeeklyStat {
  bowlerLeague: {
    bowler: Bowler;
    team: Team;
  };
}

// Keep the QubicaAMF Score Import Types but remove import-specific schemas
export interface QubicaScoreFileHeader {
  date: Date;
  centerName: string;
  leagueName: string;
  weekNumber: number;
  sessionTime: string;
  leagueId: string;
  description: string;
}

export interface QubicaBowlerScore {
  teamNumber: string;
  gameNumber: number;
  position: number;
  recordNumber: number;
  bowlerId: string;
  status: {
    isVacant: boolean;
    isAbsent: boolean;
    isSub: boolean;
  };
  score: number;
  laneNumber: number;
  bowlerName: string;
  scoreSheet: string;
  handicap: number;
  average: number;
  hasBumpers: boolean;
  frames: string[];
  splits: string[];
  notes: string[];
}

export interface QubicaTeamGame {
  teamNumber: string;
  gameNumber: number;
  teamName: string;
  laneNumber: number;
  bowlers: QubicaBowlerScore[];
}

export interface QubicaScoreImport {
  header: QubicaScoreFileHeader;
  games: QubicaTeamGame[];
}


// Add new interface for detailed score information
export interface DetailedScore extends Score {
  game: Game;
  bowler: Bowler;
  team: Team;
  frameDetails: {
    frameNumber: number;
    rolls: string[];
    score: number;
    isSplit: boolean;
    splitPins?: string;
    notes?: string[];
  }[];
}