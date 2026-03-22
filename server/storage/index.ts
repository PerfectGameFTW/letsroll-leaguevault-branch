import type { IStorage } from "./types";

import * as leagueStorage from "./leagues";
import * as teamStorage from "./teams";
import * as bowlerStorage from "./bowlers";
import * as paymentStorage from "./payments";
import * as gameScoreStorage from "./games-scores";
import * as userStorage from "./users";
import * as orgStorage from "./organizations";
import * as locationStorage from "./locations";
import * as emailTemplateStorage from "./email-templates";

export type { IStorage };

export class DatabaseStorage implements IStorage {
  getLeagues = leagueStorage.getLeagues;
  getLeague = leagueStorage.getLeague;
  createLeague = leagueStorage.createLeague;
  updateLeague = leagueStorage.updateLeague;
  deleteLeague = leagueStorage.deleteLeague;
  archiveLeague = leagueStorage.archiveLeague;
  restoreLeague = leagueStorage.restoreLeague;
  getOrganizationLeagues = leagueStorage.getOrganizationLeagues;
  getLeaguesByIds = leagueStorage.getLeaguesByIds;

  getTeams = teamStorage.getTeams;
  getTeam = teamStorage.getTeam;
  createTeam = teamStorage.createTeam;
  updateTeam = teamStorage.updateTeam;
  deleteTeam = teamStorage.deleteTeam;
  getTeamByNumber = teamStorage.getTeamByNumber;
  getTeamsByIds = teamStorage.getTeamsByIds;

  getBowlers = bowlerStorage.getBowlers;
  getBowler = bowlerStorage.getBowler;
  createBowler = bowlerStorage.createBowler;
  updateBowler = bowlerStorage.updateBowler;
  updateBowlerBnContactId = bowlerStorage.updateBowlerBnContactId;
  deleteBowler = bowlerStorage.deleteBowler;
  getBowlerLeagues = bowlerStorage.getBowlerLeaguesFiltered;
  getBowlerLeague = bowlerStorage.getBowlerLeague;
  createBowlerLeague = bowlerStorage.createBowlerLeague;
  updateBowlerLeague = bowlerStorage.updateBowlerLeague;
  updateBowlerLeagueOrder = bowlerStorage.updateBowlerLeagueOrder;
  deleteBowlerLeague = bowlerStorage.deleteBowlerLeague;
  getBowlersByIds = bowlerStorage.getBowlersByIds;
  getBowlerLeaguesByBowlerIds = bowlerStorage.getBowlerLeaguesByBowlerIds;
  getBowlerByEmail = bowlerStorage.getBowlerByEmail;

  getPayments = paymentStorage.getPayments;
  getPaymentsPaginated = paymentStorage.getPaymentsPaginated;
  getPaymentById = paymentStorage.getPaymentById;
  getPaymentByIdempotencyKey = paymentStorage.getPaymentByIdempotencyKey;
  createPayment = paymentStorage.createPayment;
  updatePayment = paymentStorage.updatePayment;
  refundPayment = paymentStorage.refundPayment;
  deletePayment = paymentStorage.deletePayment;
  createPaymentSchedule = paymentStorage.createPaymentSchedule;
  getPaymentSchedule = paymentStorage.getPaymentSchedule;
  getPaymentScheduleById = paymentStorage.getPaymentScheduleById;
  getActiveSchedulesByLeague = paymentStorage.getActiveSchedulesByLeague;
  deactivatePaymentSchedule = paymentStorage.deactivatePaymentSchedule;
  updatePaymentScheduleFields = paymentStorage.updatePaymentScheduleFields;
  updatePaymentScheduleCard = paymentStorage.updatePaymentScheduleCard;

  getGames = gameScoreStorage.getGames;
  getGame = gameScoreStorage.getGame;
  createGame = gameScoreStorage.createGame;
  updateGame = gameScoreStorage.updateGame;
  deleteGame = gameScoreStorage.deleteGame;
  getScores = gameScoreStorage.getScores;
  getScore = gameScoreStorage.getScore;
  getBowlerScores = gameScoreStorage.getBowlerScores;
  createScore = gameScoreStorage.createScore;
  updateScore = gameScoreStorage.updateScore;
  deleteScore = gameScoreStorage.deleteScore;
  createBatchScores = gameScoreStorage.createBatchScores;
  getGameScores = gameScoreStorage.getGameScores;
  getScoresByLeagueAndWeek = gameScoreStorage.getScoresByLeagueAndWeek;
  getScoresByGameIds = gameScoreStorage.getScoresByGameIds;

  getUser = userStorage.getUser;
  getUserByEmail = userStorage.getUserByEmail;
  getUsers = userStorage.getUsers;
  createUser = userStorage.createUser;
  updateUser = userStorage.updateUser;
  linkUserToBowler = userStorage.linkUserToBowler;
  getLinkedBowlerIds = userStorage.getLinkedBowlerIds;
  isBowlerLinked = userStorage.isBowlerLinked;
  hasAdminUsers = userStorage.hasAdminUsers;
  updateUserRole = userStorage.updateUserRole;
  setUserLocation = userStorage.setUserLocation;
  getUserByInviteToken = userStorage.getUserByInviteToken;
  setUserInviteToken = userStorage.setUserInviteToken;
  clearUserInviteToken = userStorage.clearUserInviteToken;

  getOrganizations = orgStorage.getOrganizations;
  getOrganization = orgStorage.getOrganization;
  getOrganizationBySlug = orgStorage.getOrganizationBySlug;
  createOrganization = orgStorage.createOrganization;
  updateOrganization = orgStorage.updateOrganization;
  deleteOrganization = orgStorage.deleteOrganization;
  archiveOrganization = orgStorage.archiveOrganization;
  restoreOrganization = orgStorage.restoreOrganization;
  getUserOrganizations = orgStorage.getUserOrganizations;
  setUserOrganization = orgStorage.setUserOrganization;
  getOrgIntegrations = orgStorage.getOrgIntegrations;
  updateOrgIntegrations = orgStorage.updateOrgIntegrations;
  getOrganizationUsers = orgStorage.getOrganizationUsers;

  getLocations = locationStorage.getLocations;
  getLocation = locationStorage.getLocation;
  createLocation = locationStorage.createLocation;
  updateLocation = locationStorage.updateLocation;
  deleteLocation = locationStorage.deleteLocation;
  archiveLocation = locationStorage.archiveLocation;
  restoreLocation = locationStorage.restoreLocation;
  getLocationSquareConfig = locationStorage.getLocationSquareConfig;
  updateLocationSquareConfig = locationStorage.updateLocationSquareConfig;
  getFirstSquareConfiguredLocation = locationStorage.getFirstSquareConfiguredLocation;

  getEmailTemplates = emailTemplateStorage.getEmailTemplates;
  getEmailTemplate = emailTemplateStorage.getEmailTemplate;
  getEmailTemplateBySlug = emailTemplateStorage.getEmailTemplateBySlug;
  updateEmailTemplate = emailTemplateStorage.updateEmailTemplate;
}

export const storage = new DatabaseStorage();
