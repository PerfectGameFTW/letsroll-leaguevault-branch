import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '@shared/schema';

export class QubicaScoreParser {
  private lines: string[];
  private currentIndex: number = 0;

  constructor(fileContent: string) {
    this.lines = fileContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    console.log(`[QubicaParser] Initialized with ${this.lines.length} non-empty lines`);
  }

  private parseHeader(): QubicaScoreFileHeader {
    const headerLine = this.lines[0];
    console.log('[QubicaParser] Processing header line:', headerLine);

    try {
      // Parse fixed-width header format
      const leagueId = headerLine.substring(0, 6);
      const leagueName = headerLine.substring(20, 60).trim();

      // Extract date and time from positions
      const year = parseInt(headerLine.substring(92, 96));
      const month = parseInt(headerLine.substring(96, 98));
      const day = parseInt(headerLine.substring(98, 100));
      const hour = parseInt(headerLine.substring(100, 102));
      const minute = parseInt(headerLine.substring(102, 104));

      // Create date object
      const date = new Date(year, month - 1, day, hour, minute);

      // Extract week number from specific position
      const weekNumber = parseInt(headerLine.substring(84, 86));

      const header: QubicaScoreFileHeader = {
        date,
        centerName: "Bonnie Lanes",
        leagueName: leagueName || 'Unknown League',
        weekNumber: weekNumber || 1,
        sessionTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
        leagueId,
        description: headerLine.substring(60, 90).trim()
      };

      console.log('[QubicaParser] Parsed header:', header);
      return header;
    } catch (error) {
      console.error('[QubicaParser] Error parsing header:', error);
      throw new Error(`Failed to parse header: ${error}`);
    }
  }

  private isTeamHeaderLine(line: string): boolean {
    // Team header format: lane (2) + team name (40)
    return line.length > 42 && /^\d{2}[A-Za-z ]/.test(line);
  }

  private isBowlerLine(line: string): boolean {
    // Bowler line format: lane (2) + spaces (6) + position (2)
    return line.length > 100 && /^\d{2}\s+\d{2}\s+\d/.test(line);
  }

  private parseBowlerLine(line: string): QubicaBowlerScore | null {
    if (!this.isBowlerLine(line)) return null;

    try {
      // Parse fixed-width format
      const laneNumber = parseInt(line.substring(0, 2));
      const teamNumber = line.substring(6, 8).trim();
      const position = parseInt(line.substring(8, 10));
      const bowlerId = line.substring(10, 14).trim();
      const bowlerName = line.substring(20, 60).trim();
      const gender = line.substring(60, 61);
      const score = parseInt(line.substring(90, 93));

      // Parse status flags
      const statusStr = line.substring(88, 89);
      const isVacant = statusStr === 'V' || bowlerName.toUpperCase().includes('VACANT');
      const isAbsent = statusStr === 'A';
      const isSub = statusStr === 'S';

      // Parse handicap and average from fixed positions
      const handicap = parseInt(line.substring(62, 65)) || 0;
      const average = parseInt(line.substring(66, 69)) || 0;

      if (isNaN(position) || isNaN(laneNumber)) {
        console.log('[QubicaParser] Invalid numeric values in line:', line);
        return null;
      }

      const bowlerScore: QubicaBowlerScore = {
        teamNumber,
        gameNumber: 1, // Will be adjusted based on position in file
        position,
        recordNumber: parseInt(bowlerId) || 0,
        bowlerId,
        status: {
          isVacant,
          isAbsent,
          isSub
        },
        score: score || 0,
        laneNumber,
        bowlerName,
        scoreSheet: '',
        handicap,
        average,
        hasBumpers: false
      };

      console.log('[QubicaParser] Parsed bowler:', {
        name: bowlerScore.bowlerName,
        team: bowlerScore.teamNumber,
        game: bowlerScore.gameNumber,
        lane: bowlerScore.laneNumber,
        score: bowlerScore.score,
        isVacant,
        isAbsent,
        isSub
      });

      return bowlerScore;
    } catch (error) {
      console.error('[QubicaParser] Error parsing bowler line:', error);
      return null;
    }
  }

  public parse(): QubicaScoreImport {
    console.log('[QubicaParser] Starting to parse score file');
    const header = this.parseHeader();

    const games: QubicaTeamGame[] = [];
    const teamGames = new Map<string, Map<number, QubicaBowlerScore[]>>();
    let currentTeamName = '';
    let currentGameNumber = 1;
    let lastTeamComplete = true;

    // Skip header
    this.currentIndex = 1;

    // Process all score lines
    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex];

      // Update team name if this is a team header
      if (this.isTeamHeaderLine(line)) {
        currentTeamName = line.substring(2, 42).trim();
        lastTeamComplete = true;
      } else {
        const bowlerScore = this.parseBowlerLine(line);
        if (bowlerScore) {
          // Update game number based on position in file
          bowlerScore.gameNumber = currentGameNumber;

          const { teamNumber } = bowlerScore;

          // Initialize team's games map if needed
          if (!teamGames.has(teamNumber)) {
            teamGames.set(teamNumber, new Map());
          }

          // Initialize game's bowlers array if needed
          const teamGameMap = teamGames.get(teamNumber)!;
          if (!teamGameMap.has(currentGameNumber)) {
            teamGameMap.set(currentGameNumber, []);
          }

          // Add bowler score to the appropriate game
          const bowlers = teamGameMap.get(currentGameNumber)!;
          bowlers.push(bowlerScore);

          // Check if we've completed a full team (4 bowlers)
          if (bowlers.length === 4) {
            lastTeamComplete = true;
          }
        } else if (line.trim().length === 0 && lastTeamComplete) {
          // Empty line after a complete team indicates start of next game
          currentGameNumber++;
          lastTeamComplete = false;
        }
      }

      this.currentIndex++;
    }

    // Convert collected data into QubicaTeamGame objects
    for (const [teamNumber, teamGameMap] of teamGames) {
      for (const [gameNumber, bowlers] of teamGameMap) {
        // Sort bowlers by position
        bowlers.sort((a, b) => a.position - b.position);

        // Use the lane number from the first bowler's score
        const laneNumber = bowlers[0]?.laneNumber ?? 0;

        // Create team game
        const teamGame: QubicaTeamGame = {
          teamNumber,
          gameNumber,
          teamName: currentTeamName || `Team ${teamNumber}`,
          laneNumber,
          bowlers
        };

        games.push(teamGame);
      }
    }

    // Sort all games by lane number and game number
    games.sort((a, b) => {
      if (a.laneNumber === b.laneNumber) {
        return a.gameNumber - b.gameNumber;
      }
      return a.laneNumber - b.laneNumber;
    });

    console.log('[QubicaParser] Parsing complete. Found:', {
      gameCount: games.length,
      teams: Array.from(teamGames.keys()),
      bowlerCount: games.reduce((sum, game) => sum + game.bowlers.length, 0)
    });

    return { header, games };
  }
}

export const parseQubicaScoreFile = (fileContent: string): QubicaScoreImport => {
  const parser = new QubicaScoreParser(fileContent);
  return parser.parse();
};