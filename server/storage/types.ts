import type {
  League, InsertLeague, UpdateLeague,
  Team, InsertTeam, UpdateTeam,
  Bowler, InsertBowler, UpdateBowler,
  BowlerLeague, InsertBowlerLeague, UpdateBowlerLeague,
  Payment, InsertPayment, UpdatePayment,
  Game, InsertGame, UpdateGame,
  Score, InsertScore, UpdateScore,
  User, InsertUser, UpdateUser,
  Organization, InsertOrganization, UpdateOrganization,
  Location, InsertLocation, UpdateLocation,
  PaymentSchedule, InsertPaymentSchedule,
  UserRole,
  OrgIntegrations,
  LocationSquareCredentials,
  PaginatedResult,
  EmailTemplate, InsertEmailTemplate,
} from "@shared/schema";

export interface IStorage {
  getLeagues(organizationId?: number | null): Promise<League[]>;
  getLeague(id: number): Promise<League | undefined>;
  createLeague(league: InsertLeague): Promise<League>;
  updateLeague(id: number, league: UpdateLeague): Promise<League>;
  deleteLeague(id: number): Promise<void>;

  getTeams(leagueId?: number): Promise<Team[]>;
  getTeam(id: number): Promise<Team | undefined>;
  createTeam(team: InsertTeam): Promise<Team>;
  updateTeam(id: number, team: UpdateTeam): Promise<Team>;
  deleteTeam(id: number): Promise<void>;

  getBowlers(teamId?: number, organizationId?: number): Promise<Bowler[]>;
  getBowler(id: number): Promise<Bowler | undefined>;
  createBowler(bowler: InsertBowler): Promise<Bowler>;
  updateBowler(id: number, bowler: UpdateBowler): Promise<Bowler>;
  updateBowlerBnContactId(bowlerId: number, bnContactId: string): Promise<void>;
  deleteBowler(id: number): Promise<void>;

  getBowlerLeagues(filters?: { bowlerId?: number; leagueId?: number; teamId?: number }): Promise<BowlerLeague[]>;
  getBowlerLeague(id: number): Promise<BowlerLeague | undefined>;
  createBowlerLeague(bowlerLeague: InsertBowlerLeague): Promise<BowlerLeague>;
  updateBowlerLeague(id: number, bowlerLeague: UpdateBowlerLeague): Promise<BowlerLeague>;
  updateBowlerLeagueOrder(id: number, newOrder: number): Promise<BowlerLeague[]>;
  deleteBowlerLeague(id: number): Promise<boolean>;

  getPayments(bowlerId?: number, leagueId?: number, teamId?: number, weekOf?: Date, organizationId?: number): Promise<Payment[]>;
  getPaymentsPaginated(filters: { bowlerId?: number; leagueId?: number; teamId?: number; weekOf?: Date; organizationId?: number }, page: number, limit: number): Promise<PaginatedResult<Payment>>;
  getPaymentById(id: number): Promise<Payment | undefined>;
  getPaymentByIdempotencyKey(key: string): Promise<Payment | undefined>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePayment(id: number, payment: UpdatePayment): Promise<Payment>;
  refundPayment(id: number, squareRefundId?: string, reason?: string): Promise<Payment>;
  deletePayment(id: number): Promise<void>;

  getGames(leagueId: number, weekNumber?: number): Promise<Game[]>;
  getGame(id: number): Promise<Game | undefined>;
  createGame(game: InsertGame): Promise<Game>;
  updateGame(id: number, game: UpdateGame): Promise<Game>;
  deleteGame(id: number): Promise<void>;

  getScores(gameId: number, teamId?: number): Promise<Score[]>;
  getScore(id: number): Promise<Score | undefined>;
  getBowlerScores(bowlerId: number): Promise<Score[]>;
  createScore(score: InsertScore): Promise<Score>;
  updateScore(id: number, score: UpdateScore): Promise<Score>;
  deleteScore(id: number): Promise<void>;

  createBatchScores(scores: InsertScore[]): Promise<Score[]>;
  getGameScores(gameId: number): Promise<Score[]>;
  getTeamByNumber(leagueId: number, teamNumber: number): Promise<Team | undefined>;
  getScoresByLeagueAndWeek(leagueId: number, weekNumber: number): Promise<Score[]>;

  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, userData: UpdateUser): Promise<User>;
  linkUserToBowler(userId: number, bowlerId: number | undefined): Promise<User>;
  getLinkedBowlerIds(): Promise<number[]>;
  isBowlerLinked(bowlerId: number): Promise<boolean>;
  hasAdminUsers(): Promise<boolean>;
  getLeaguesByIds(ids: number[]): Promise<League[]>;
  getBowlersByIds(ids: number[]): Promise<Bowler[]>;
  getTeamsByIds(ids: number[]): Promise<Team[]>;
  getScoresByGameIds(gameIds: number[]): Promise<Score[]>;
  getBowlerLeaguesByBowlerIds(bowlerIds: number[]): Promise<BowlerLeague[]>;
  updateUserRole(userId: number, role: UserRole): Promise<User>;
  createPaymentSchedule(schedule: InsertPaymentSchedule): Promise<PaymentSchedule>;
  getPaymentSchedule(bowlerId: number, leagueId: number): Promise<PaymentSchedule | undefined>;
  getPaymentScheduleById(id: number): Promise<PaymentSchedule | undefined>;
  getActiveSchedulesByLeague(leagueId: number): Promise<PaymentSchedule[]>;
  deactivatePaymentSchedule(id: number): Promise<void>;
  updatePaymentScheduleFields(id: number, fields: Partial<Pick<PaymentSchedule, 'frequency' | 'amount' | 'nextPaymentDate' | 'squareCardId'>>): Promise<PaymentSchedule>;
  updatePaymentScheduleCard(bowlerId: number, leagueId: number, cardId: string): Promise<void>;

  archiveLeague(id: number): Promise<League>;
  restoreLeague(id: number): Promise<League>;

  getOrganizations(): Promise<Organization[]>;
  getOrganization(id: number): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  createOrganization(organization: InsertOrganization): Promise<Organization>;
  updateOrganization(id: number, organization: UpdateOrganization): Promise<Organization>;
  deleteOrganization(id: number): Promise<void>;
  archiveOrganization(id: number): Promise<Organization>;
  restoreOrganization(id: number): Promise<Organization>;
  getUserOrganizations(userId: number): Promise<Organization[]>;
  setUserOrganization(userId: number, organizationId: number | null): Promise<User>;
  getOrganizationLeagues(organizationId: number): Promise<League[]>;
  getOrgIntegrations(orgId: number): Promise<OrgIntegrations | null>;
  updateOrgIntegrations(orgId: number, integrations: OrgIntegrations): Promise<Organization>;

  getOrganizationUsers(organizationId: number): Promise<User[]>;

  setUserLocation(userId: number, locationId: number | null): Promise<User>;
  getUserByInviteToken(token: string): Promise<User | undefined>;
  setUserInviteToken(userId: number, token: string, expiry: Date): Promise<User>;
  clearUserInviteToken(userId: number): Promise<User>;
  getBowlerByEmail(email: string, organizationId?: number): Promise<Bowler | undefined>;

  getLocations(organizationId?: number | null): Promise<Location[]>;
  getLocation(id: number): Promise<Location | undefined>;
  createLocation(data: InsertLocation): Promise<Location>;
  updateLocation(id: number, data: UpdateLocation): Promise<Location>;
  deleteLocation(id: number): Promise<void>;
  archiveLocation(id: number): Promise<Location>;
  restoreLocation(id: number): Promise<Location>;
  getLocationSquareConfig(locationId: number): Promise<LocationSquareCredentials | null>;
  updateLocationSquareConfig(locationId: number, creds: LocationSquareCredentials): Promise<Location>;
  getFirstSquareConfiguredLocation(orgId: number): Promise<Location | undefined>;

  getEmailTemplates(): Promise<EmailTemplate[]>;
  getEmailTemplate(id: number): Promise<EmailTemplate | undefined>;
  getEmailTemplateBySlug(slug: string): Promise<EmailTemplate | undefined>;
  updateEmailTemplate(id: number, data: Partial<InsertEmailTemplate>): Promise<EmailTemplate>;
}
