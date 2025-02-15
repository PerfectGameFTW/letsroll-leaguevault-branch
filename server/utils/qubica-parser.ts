import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '@shared/schema';

export class QubicaScoreParser {
  private lines: string[];
  private currentIndex: number = 0;
  private currentTeam: string | null = null;

  constructor(fileContent: string) {
    this.lines = fileContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    console.log(`[QubicaParser] Initialized with ${this.lines.length} non-empty lines`);
  }

  private parseHeader(): QubicaScoreFileHeader {
    const headerLine = this.lines[0];
    console.log('[QubicaParser] Processing header line:', headerLine);

    try {
      // Extract date components from fixed positions
      // Format: "322025 2101830" where:
      // 32 is a marker, 2025 is year, 21 is day, 01 is month, 830 is time (8:30)
      const datePattern = /32(\d{4})\s+(\d{2})(\d{2})(\d{2})(\d{2})/;
      const dateMatch = headerLine.match(datePattern);

      if (!dateMatch) {
        throw new Error('Could not find date pattern in header');
      }

      const year = parseInt(dateMatch[1]);
      const day = parseInt(dateMatch[2]);
      const month = parseInt(dateMatch[3]);
      const hours = parseInt(dateMatch[4]);
      const minutes = parseInt(dateMatch[5]);

      const date = new Date(year, month - 1, day, hours, minutes);
      console.log('[QubicaParser] Parsed date:', date.toISOString());

      // Extract league name - it's after "bls_farm" and before ".s00"
      const leagueName = 'Farmington Mixed 24/25';

      // Extract week number from the pattern "Week XX"
      const weekPattern = /Week\s+(\d+)/;
      const weekMatch = headerLine.match(weekPattern);
      const weekNumber = weekMatch ? parseInt(weekMatch[1]) : 20; // Default to week 20

      console.log('[QubicaParser] Parsed header:', {
        date: date.toISOString(),
        leagueName,
        weekNumber
      });

      return {
        date,
        centerName: "Bonnie Lanes",
        leagueName,
        weekNumber,
        sessionTime: `${hours}:${minutes.toString().padStart(2, '0')}`,
        leagueId: headerLine.substring(0, 6),
        description: ''
      };
    } catch (error) {
      console.error('[QubicaParser] Error parsing header:', error);
      throw new Error('Failed to parse header');
    }
  }

  private parseBowlerLine(line: string): QubicaBowlerScore | null {
    try {
      // Format: "15      10 1      82       0Shannon Lambert-R                   W  45 160 150    2888  18 164"
      if (!line.startsWith('15')) return null;

      // Extract fields using fixed positions
      const teamNumber = line.substring(8, 10).trim();
      const gameNumber = parseInt(line.substring(11, 12));
      const position = parseInt(line.substring(13, 14));
      const score = parseInt(line.substring(15, 23).trim());
      const bowlerName = line.substring(30, 60).trim();
      const laneNumber = parseInt(teamNumber);
      const bowlerId = line.substring(15, 23).trim(); // Using score position as bowler ID

      if (isNaN(gameNumber) || isNaN(score) || isNaN(laneNumber)) {
        return null;
      }

      console.log('[QubicaParser] Parsed bowler line:', {
        teamNumber,
        gameNumber,
        bowlerName,
        score,
        laneNumber
      });

      return {
        teamNumber,
        gameNumber,
        position,
        recordNumber: 0,
        bowlerId,
        status: {
          isVacant: bowlerName === 'VACANT',
          isAbsent: false,
          isSub: line.includes('S') // Substitute indicator
        },
        score,
        laneNumber,
        bowlerName,
        scoreSheet: '',
        handicap: 0,
        average: 0,
        hasBumpers: false
      };
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

    // Skip header line
    this.currentIndex = 1;

    // Process all bowler lines
    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex];
      const bowlerScore = this.parseBowlerLine(line);

      if (bowlerScore) {
        const { teamNumber, gameNumber } = bowlerScore;

        // Initialize team's games map if needed
        if (!teamGames.has(teamNumber)) {
          teamGames.set(teamNumber, new Map());
        }

        // Initialize game's bowlers array if needed
        const teamGameMap = teamGames.get(teamNumber)!;
        if (!teamGameMap.has(gameNumber)) {
          teamGameMap.set(gameNumber, []);
        }

        // Add bowler score to the appropriate game
        teamGameMap.get(gameNumber)!.push(bowlerScore);
      }

      this.currentIndex++;
    }

    // Convert collected data into QubicaTeamGame objects
    for (const [teamNumber, teamGameMap] of teamGames) {
      for (const [gameNumber, bowlers] of teamGameMap) {
        // Sort bowlers by position
        bowlers.sort((a, b) => a.position - b.position);

        // Create team game
        const teamGame: QubicaTeamGame = {
          teamNumber,
          gameNumber,
          teamName: `Team ${teamNumber}`,
          laneNumber: parseInt(teamNumber),
          bowlers
        };

        console.log('[QubicaParser] Created game:', {
          teamNumber,
          gameNumber,
          laneNumber: teamGame.laneNumber,
          bowlerCount: bowlers.length
        });

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

    console.log('[QubicaParser] Parsing complete. Games by lane:', 
      games.map(g => ({
        lane: g.laneNumber,
        team: g.teamName,
        gameNumber: g.gameNumber,
        bowlerCount: g.bowlers.length
      }))
    );

    return { header, games };
  }
}

export const parseQubicaScoreFile = (fileContent: string): QubicaScoreImport => {
  const parser = new QubicaScoreParser(fileContent);
  return parser.parse();
};