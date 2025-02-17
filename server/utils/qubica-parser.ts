import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '@shared/schema';

export class QubicaParser {
  private lines: string[];
  private currentIndex: number = 0;

  constructor(fileContent: string) {
    // Split while preserving whitespace and line endings, and filter out empty lines
    this.lines = fileContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    console.log(`[QubicaParser] Initialized with ${this.lines.length} lines`);
  }

  private parseLine(line: string): { [key: string]: string } {
    // Parse fixed-width format fields
    const fields = {
      teamNumber: line.substring(0, 3),
      gameSequence: line.substring(3, 5),
      position: line.substring(5, 7),
      recordNumber: line.substring(7, 10),
      bowlerId: line.substring(10, 15),
      statusFlags: line.substring(15, 20),
      name: line.substring(20, 50),
      score: line.substring(50, 55),
      lane: line.substring(55, 58),
      frames: line.substring(58).trim()
    };

    console.log('[QubicaParser] Parsed line fields:', {
      raw: line.substring(0, 100),
      fields
    });

    return fields;
  }

  private parseBowlerScore(line: string): QubicaBowlerScore | null {
    try {
      const fields = this.parseLine(line);

      // Remove leading zeros from team number and convert to integer
      const teamNumber = String(parseInt(fields.teamNumber) || 0);
      const position = parseInt(fields.position) || 0;
      const bowlerId = fields.bowlerId.trim();
      const name = fields.name.trim();
      const score = parseInt(fields.score) || 0;
      const laneNumber = parseInt(fields.lane) || 0;
      const gameSequence = parseInt(fields.gameSequence) || 1;

      // Check for status flags
      const statusFlags = fields.statusFlags.toUpperCase();
      const status = {
        isVacant: name.toUpperCase().includes('VACANT'),
        isAbsent: statusFlags.includes('A'),
        isSub: statusFlags.includes('S')
      };

      console.log('[QubicaParser] Parsed bowler line:', {
        teamNumber,
        gameSequence,
        name,
        score,
        laneNumber,
        status
      });

      return {
        teamNumber,
        gameNumber: gameSequence,
        position,
        recordNumber: parseInt(fields.recordNumber) || 0,
        bowlerId,
        status,
        score,
        laneNumber,
        bowlerName: name,
        scoreSheet: fields.frames,
        handicap: 0,
        average: 0,
        hasBumpers: false,
        frames: [],
        splits: [],
        notes: []
      };
    } catch (error) {
      console.error('[QubicaParser] Bowler parsing error:', error);
      return null;
    }
  }

  private parseHeader(): QubicaScoreFileHeader {
    if (this.lines.length === 0) {
      throw new Error('No content to parse');
    }

    const headerLine = this.lines[0];
    console.log('[QubicaParser] Processing header line:', {
      raw: headerLine,
      length: headerLine.length
    });

    try {
      // Parse fixed width header fields
      const leagueId = headerLine.substring(0, 15).trim();
      const leagueName = headerLine.substring(23, 60).trim();

      // Week number is typically after the league name
      const weekMatch = headerLine.match(/Week\s+(\d+)/i);
      const weekNumber = weekMatch ? parseInt(weekMatch[1]) : 1;

      console.log('[QubicaParser] Parsed header:', {
        leagueId,
        leagueName,
        weekNumber
      });

      // Use current date if parsing fails
      const date = new Date();

      return {
        date,
        centerName: "Bonnie Lanes",
        leagueName: leagueName || 'Unknown League',
        weekNumber,
        sessionTime: '18:30',
        leagueId,
        description: ''
      };
    } catch (error) {
      console.error('[QubicaParser] Header parsing error:', error);
      throw error;
    }
  }

  public parse(): QubicaScoreImport {
    console.log('[QubicaParser] Starting parse process');
    const header = this.parseHeader();
    const games: QubicaTeamGame[] = [];

    // Skip header line
    this.currentIndex = 1;

    // Group bowlers by team and game
    const teamGames = new Map<string, Map<number, QubicaBowlerScore[]>>();

    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex].trim();

      if (line) {
        const bowlerScore = this.parseBowlerScore(line);
        if (bowlerScore && parseInt(bowlerScore.teamNumber) > 0) {
          const teamNumber = bowlerScore.teamNumber;
          const gameNumber = bowlerScore.gameNumber;

          if (!teamGames.has(teamNumber)) {
            teamGames.set(teamNumber, new Map());
          }

          const teamGameMap = teamGames.get(teamNumber)!;
          if (!teamGameMap.has(gameNumber)) {
            teamGameMap.set(gameNumber, []);
          }

          teamGameMap.get(gameNumber)!.push(bowlerScore);

          console.log('[QubicaParser] Added bowler score:', {
            teamNumber,
            gameNumber,
            bowlerName: bowlerScore.bowlerName,
            score: bowlerScore.score,
            laneNumber: bowlerScore.laneNumber
          });
        }
      }

      this.currentIndex++;
    }

    // Convert team games map to array format
    for (const [teamNumber, teamGameMap] of teamGames) {
      for (const [gameNumber, bowlers] of teamGameMap) {
        if (bowlers.length > 0) {
          // Sort bowlers by position
          bowlers.sort((a, b) => a.position - b.position);

          games.push({
            teamNumber,
            gameNumber,
            teamName: `Team ${teamNumber}`,
            laneNumber: bowlers[0].laneNumber,
            bowlers
          });
        }
      }
    }

    // Sort games by team number and game number
    games.sort((a, b) => {
      const teamA = parseInt(a.teamNumber);
      const teamB = parseInt(b.teamNumber);
      if (teamA === teamB) {
        return a.gameNumber - b.gameNumber;
      }
      return teamA - teamB;
    });

    console.log('[QubicaParser] Parse complete:', {
      gamesCount: games.length,
      teamCount: teamGames.size,
      teams: Array.from(teamGames.keys()).sort(),
      sampleGame: games[0] ? {
        teamNumber: games[0].teamNumber,
        gameNumber: games[0].gameNumber,
        laneNumber: games[0].laneNumber,
        bowlerCount: games[0].bowlers.length
      } : 'No games found'
    });

    return { header, games };
  }
}

export const parseQubicaScoreFile = (fileContent: string): QubicaScoreImport => {
  const parser = new QubicaParser(fileContent);
  return parser.parse();
};