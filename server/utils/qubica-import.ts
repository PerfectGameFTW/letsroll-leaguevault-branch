/**
 * Utility functions for importing QubicaAMF bowling data
 */
import { z } from "zod";
import { db } from "../db";
import { 
  series, games, weeklyStats, bowlers, teams, bowlerLeagues,
  insertSeriesSchema, insertGameSchema, insertWeeklyStatsSchema,
  insertBowlerSchema, insertTeamSchema, insertBowlerLeagueSchema
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

interface QubicaGame {
  teamNumber: string;
  gameNumber: number;
  position: number;
  recordNumber: number;
  bowlerId: string;
  status: string;
  score: number;
  laneNumber: number;
  bowlerName: string;
  teamName: string;
  handicap: number;
  average: number;
}

const parseQubicaLine = (line: string): QubicaGame | null => {
  const fields = line.split('\t');

  // Skip header or invalid lines
  if (fields.length < 10 || line.startsWith('*')) {
    return null;
  }

  // Parse team name from team record (position 0)
  const isTeamRecord = parseInt(fields[2], 10) === 0;
  const teamName = isTeamRecord ? fields[9] : '';

  return {
    teamNumber: fields[0],
    gameNumber: parseInt(fields[1], 10),
    position: parseInt(fields[2], 10),
    recordNumber: parseInt(fields[3], 10),
    bowlerId: fields[4],
    status: fields[6] || 'regular',
    score: parseInt(fields[7], 10),
    laneNumber: parseInt(fields[8], 10),
    bowlerName: fields[9],
    teamName,
    handicap: parseInt(fields[10], 10),
    average: parseInt(fields[11], 10),
  };
};

const parseQubicaHeader = (headerLine: string) => {
  // Parse date, league name, week number from header
  const [dateStr, , leagueName, weekStr] = headerLine.split('\t');
  const weekNumber = parseInt(weekStr.split(' ')[1], 10);
  const seriesDate = new Date(dateStr);

  return {
    leagueName,
    weekNumber,
    seriesDate,
  };
};

const getBowlerLeagueId = async (bowlerId: number, teamId: number, leagueId: number) => {
  // Check for existing bowlerLeague record
  const existingRecord = await db.select()
    .from(bowlerLeagues)
    .where(
      and(
        eq(bowlerLeagues.bowlerId, bowlerId),
        eq(bowlerLeagues.teamId, teamId),
        eq(bowlerLeagues.leagueId, leagueId)
      )
    )
    .execute();

  if (existingRecord.length > 0) {
    return existingRecord[0].id;
  }

  // Create new bowlerLeague record if none exists
  const newRecord = await db.insert(bowlerLeagues)
    .values({
      bowlerId,
      teamId,
      leagueId,
      active: true,
      order: 0, // Default order
    })
    .returning()
    .execute();

  return newRecord[0].id;
};

const getOrCreateTeam = async (teamNumber: string, teamName: string, leagueId: number) => {
  console.log(`[QubicaImport] Checking for existing team: ${teamName} (number: ${teamNumber})`);

  // Check for existing team
  const existingTeams = await db.select()
    .from(teams)
    .where(
      and(
        eq(teams.leagueId, leagueId),
        eq(teams.number, parseInt(teamNumber))
      )
    )
    .execute();

  if (existingTeams.length > 0) {
    console.log(`[QubicaImport] Found existing team: ${existingTeams[0].name} (id: ${existingTeams[0].id})`);
    return existingTeams[0];
  }

  // Create new team if none exists
  console.log(`[QubicaImport] Creating new team: ${teamName}`);
  const teamData = insertTeamSchema.parse({
    leagueId,
    number: parseInt(teamNumber),
    name: teamName,
    active: true,
  });

  const [newTeam] = await db.insert(teams)
    .values(teamData)
    .returning()
    .execute();

  console.log(`[QubicaImport] Created new team with id: ${newTeam.id}`);
  return newTeam;
};

export const importQubicaFile = async (fileContent: string, leagueId: number) => {
  try {
    console.log('[QubicaImport] Starting import process...');
    const lines = fileContent.split('\n');
    const header = parseQubicaHeader(lines[0]);

    // Create series record
    const seriesData = insertSeriesSchema.parse({
      leagueId,
      weekNumber: header.weekNumber,
      seriesDate: header.seriesDate,
      isComplete: true,
    });

    const newSeries = await db.insert(series).values(seriesData).returning().execute();
    const seriesId = newSeries[0].id;

    // Track teams and bowlers we've seen
    const processedTeams = new Map<string, number>();
    const processedBowlers = new Map<string, number>();

    // First pass: Process team records only
    console.log('[QubicaImport] Processing team records...');
    for (const line of lines.slice(1)) {
      const game = parseQubicaLine(line);
      if (!game || game.position !== 0 || !game.teamName) continue;

      console.log(`[QubicaImport] Processing team record: ${game.teamName} (number: ${game.teamNumber})`);
      const team = await getOrCreateTeam(game.teamNumber, game.teamName, leagueId);
      processedTeams.set(game.teamNumber, team.id);
    }

    console.log(`[QubicaImport] Processed ${processedTeams.size} teams`);

    // Second pass: Process games and stats
    for (const line of lines.slice(1)) {
      const game = parseQubicaLine(line);
      if (!game || game.position === 0) continue; // Skip team records

      const teamId = processedTeams.get(game.teamNumber);
      if (!teamId) {
        console.error(`Team ${game.teamNumber} not found for bowler ${game.bowlerName}`);
        continue;
      }

      // Ensure bowler exists
      let bowlerId = processedBowlers.get(game.bowlerId);
      if (!bowlerId) {
        const bowlerData = insertBowlerSchema.parse({
          name: game.bowlerName,
          email: `${game.bowlerId}@placeholder.com`, // Placeholder email
          qubicaId: game.bowlerId,
          active: true,
        });

        const bowler = await db.insert(bowlers)
          .values(bowlerData)
          .returning()
          .execute();
        bowlerId = bowler[0].id;
        processedBowlers.set(game.bowlerId, bowlerId);
      }

      // Get or create bowlerLeague record
      const bowlerLeagueId = await getBowlerLeagueId(bowlerId, teamId, leagueId);

      // Record game
      const gameData = insertGameSchema.parse({
        seriesId,
        bowlerLeagueId,
        gameNumber: game.gameNumber,
        score: game.score,
        handicap: game.handicap,
        laneNumber: game.laneNumber,
        status: game.status === 'S' ? 'substitute' : 
                game.status === 'V' ? 'vacant' : 
                game.status === 'A' ? 'absent' : 'regular',
      });

      await db.insert(games)
        .values(gameData)
        .execute();

      // Update weekly stats if this is the first game
      if (game.gameNumber === 1) {
        const statsData = insertWeeklyStatsSchema.parse({
          seriesId,
          bowlerLeagueId,
          average: game.average,
          handicap: game.handicap,
          gamesPlayed: 3, // Assuming 3 games per series
        });

        await db.insert(weeklyStats)
          .values(statsData)
          .execute();
      }
    }

    return {
      seriesId,
      weekNumber: header.weekNumber,
      importedGames: lines.length - 1,
      success: true,
    };
  } catch (error) {
    console.error('Error importing QubicaAMF file:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};