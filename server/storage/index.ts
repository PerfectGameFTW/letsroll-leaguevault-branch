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
  getLeagues!: IStorage["getLeagues"];
  getAllLeagues!: IStorage["getAllLeagues"];
  getLeague!: IStorage["getLeague"];
  getLeaguesByIds!: IStorage["getLeaguesByIds"];
  createLeague!: IStorage["createLeague"];
  updateLeague!: IStorage["updateLeague"];
  deleteLeague!: IStorage["deleteLeague"];
  archiveLeague!: IStorage["archiveLeague"];
  restoreLeague!: IStorage["restoreLeague"];
  getOrganizationLeagues!: IStorage["getOrganizationLeagues"];

  getTeams!: IStorage["getTeams"];
  getTeam!: IStorage["getTeam"];
  getTeamsByIds!: IStorage["getTeamsByIds"];
  getTeamByNumber!: IStorage["getTeamByNumber"];
  createTeam!: IStorage["createTeam"];
  updateTeam!: IStorage["updateTeam"];
  deleteTeam!: IStorage["deleteTeam"];

  getBowlers!: IStorage["getBowlers"];
  getAllBowlers!: IStorage["getAllBowlers"];
  getBowler!: IStorage["getBowler"];
  getBowlersByIds!: IStorage["getBowlersByIds"];
  getBowlerByEmail!: IStorage["getBowlerByEmail"];
  createBowler!: IStorage["createBowler"];
  updateBowler!: IStorage["updateBowler"];
  updateBowlerBnContactId!: IStorage["updateBowlerBnContactId"];
  deleteBowler!: IStorage["deleteBowler"];
  getBowlerLeagues!: IStorage["getBowlerLeagues"];
  getBowlerLeague!: IStorage["getBowlerLeague"];
  getBowlerLeaguesByBowlerIds!: IStorage["getBowlerLeaguesByBowlerIds"];
  createBowlerLeague!: IStorage["createBowlerLeague"];
  updateBowlerLeague!: IStorage["updateBowlerLeague"];
  updateBowlerLeagueOrder!: IStorage["updateBowlerLeagueOrder"];
  deleteBowlerLeague!: IStorage["deleteBowlerLeague"];

  getPayments!: IStorage["getPayments"];
  getAllPayments!: IStorage["getAllPayments"];
  getPaymentsPaginated!: IStorage["getPaymentsPaginated"];
  getPaymentById!: IStorage["getPaymentById"];
  getPaymentByIdempotencyKey!: IStorage["getPaymentByIdempotencyKey"];
  createPayment!: IStorage["createPayment"];
  updatePayment!: IStorage["updatePayment"];
  refundPayment!: IStorage["refundPayment"];
  deletePayment!: IStorage["deletePayment"];
  createPaymentSchedule!: IStorage["createPaymentSchedule"];
  getPaymentSchedule!: IStorage["getPaymentSchedule"];
  getPaymentScheduleById!: IStorage["getPaymentScheduleById"];
  getActiveSchedulesByLeague!: IStorage["getActiveSchedulesByLeague"];
  deactivatePaymentSchedule!: IStorage["deactivatePaymentSchedule"];
  updatePaymentScheduleFields!: IStorage["updatePaymentScheduleFields"];
  updatePaymentScheduleCard!: IStorage["updatePaymentScheduleCard"];

  getGames!: IStorage["getGames"];
  getGame!: IStorage["getGame"];
  createGame!: IStorage["createGame"];
  updateGame!: IStorage["updateGame"];
  deleteGame!: IStorage["deleteGame"];
  getScores!: IStorage["getScores"];
  getScore!: IStorage["getScore"];
  getScoresByGameIds!: IStorage["getScoresByGameIds"];
  getScoresByLeagueAndWeek!: IStorage["getScoresByLeagueAndWeek"];
  getBowlerScores!: IStorage["getBowlerScores"];
  createScore!: IStorage["createScore"];
  updateScore!: IStorage["updateScore"];
  deleteScore!: IStorage["deleteScore"];
  createBatchScores!: IStorage["createBatchScores"];
  getGameScores!: IStorage["getGameScores"];

  getUser!: IStorage["getUser"];
  getUserByEmail!: IStorage["getUserByEmail"];
  getUsers!: IStorage["getUsers"];
  createUser!: IStorage["createUser"];
  updateUser!: IStorage["updateUser"];
  updateUserRole!: IStorage["updateUserRole"];
  linkUserToBowler!: IStorage["linkUserToBowler"];
  getLinkedBowlerIds!: IStorage["getLinkedBowlerIds"];
  isBowlerLinked!: IStorage["isBowlerLinked"];
  hasAdminUsers!: IStorage["hasAdminUsers"];
  setUserLocation!: IStorage["setUserLocation"];
  getUserByInviteToken!: IStorage["getUserByInviteToken"];
  setUserInviteToken!: IStorage["setUserInviteToken"];
  clearUserInviteToken!: IStorage["clearUserInviteToken"];

  getOrganizations!: IStorage["getOrganizations"];
  getOrganization!: IStorage["getOrganization"];
  getOrganizationBySlug!: IStorage["getOrganizationBySlug"];
  createOrganization!: IStorage["createOrganization"];
  updateOrganization!: IStorage["updateOrganization"];
  deleteOrganization!: IStorage["deleteOrganization"];
  archiveOrganization!: IStorage["archiveOrganization"];
  restoreOrganization!: IStorage["restoreOrganization"];
  getUserOrganizations!: IStorage["getUserOrganizations"];
  setUserOrganization!: IStorage["setUserOrganization"];
  getOrganizationUsers!: IStorage["getOrganizationUsers"];
  getOrgIntegrations!: IStorage["getOrgIntegrations"];
  updateOrgIntegrations!: IStorage["updateOrgIntegrations"];

  getLocations!: IStorage["getLocations"];
  getAllLocations!: IStorage["getAllLocations"];
  getLocation!: IStorage["getLocation"];
  createLocation!: IStorage["createLocation"];
  updateLocation!: IStorage["updateLocation"];
  deleteLocation!: IStorage["deleteLocation"];
  archiveLocation!: IStorage["archiveLocation"];
  restoreLocation!: IStorage["restoreLocation"];
  getLocationSquareConfig!: IStorage["getLocationSquareConfig"];
  updateLocationSquareConfig!: IStorage["updateLocationSquareConfig"];
  getFirstSquareConfiguredLocation!: IStorage["getFirstSquareConfiguredLocation"];

  getEmailTemplates!: IStorage["getEmailTemplates"];
  getEmailTemplate!: IStorage["getEmailTemplate"];
  getEmailTemplateBySlug!: IStorage["getEmailTemplateBySlug"];
  updateEmailTemplate!: IStorage["updateEmailTemplate"];

  constructor() {
    Object.assign(this, {
      ...leagueStorage,
      ...teamStorage,
      ...bowlerStorage,
      getBowlerLeagues: bowlerStorage.getBowlerLeaguesFiltered,
      ...paymentStorage,
      ...gameScoreStorage,
      ...userStorage,
      ...orgStorage,
      ...locationStorage,
      ...emailTemplateStorage,
    });
  }
}

export const storage = new DatabaseStorage();
