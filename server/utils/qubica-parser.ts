import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '@shared/schema';

export class QubicaScoreParser {
  private lines: string[];
  private currentIndex: number = 0;

  constructor(fileContent: string) {
    // Split while preserving whitespace and line endings
    this.lines = fileContent.split(/\r?\n/);
    console.log(`[QubicaParser] Initialized with ${this.lines.length} lines`);

    // Analyze file structure
    console.log('[QubicaParser] File structure:', {
      totalLines: this.lines.length,
      firstLines: this.lines.slice(0, 5).map(line => ({
        raw: line,
        length: line.length,
        charCodes: line.slice(0, 20).split('').map(c => c.charCodeAt(0))
      }))
    });
  }

  private parseHeader(): QubicaScoreFileHeader {
    const line = this.lines[0];
    if (!line || line.length < 104) {
      throw new Error('Invalid header line length');
    }

    try {
      // Log raw header data
      console.log('[QubicaParser] Raw header:', {
        full: line,
        segments: {
          leagueId: line.slice(0, 6),
          leagueName: line.slice(20, 60),
          weekInfo: line.slice(80, 86),
          dateTime: line.slice(92, 104)
        }
      });

      const weekNumber = parseInt(line.slice(84, 86).trim()) || 1;
      const dateInfo = {
        year: line.slice(92, 96),
        month: line.slice(96, 98),
        day: line.slice(98, 100),
        hour: line.slice(100, 102),
        minute: line.slice(102, 104)
      };

      console.log('[QubicaParser] Date components:', dateInfo);

      // Construct date, defaulting to current date if parse fails
      let date = new Date();
      const parsedYear = parseInt(dateInfo.year);
      if (!isNaN(parsedYear) && parsedYear > 2020) {
        const parsedMonth = parseInt(dateInfo.month) - 1;
        const parsedDay = parseInt(dateInfo.day);
        const parsedHour = parseInt(dateInfo.hour);
        const parsedMinute = parseInt(dateInfo.minute);

        if (!isNaN(parsedMonth) && !isNaN(parsedDay) &&
            !isNaN(parsedHour) && !isNaN(parsedMinute)) {
          date = new Date(parsedYear, parsedMonth, parsedDay, parsedHour, parsedMinute);
        }
      }

      return {
        date,
        centerName: "Bonnie Lanes",
        leagueName: line.slice(20, 60).trim(),
        weekNumber,
        sessionTime: `${parseInt(dateInfo.hour) || 0}:${parseInt(dateInfo.minute) || 0}`,
        leagueId: line.slice(0, 6).trim(),
        description: line.slice(60, 90).trim()
      };
    } catch (error) {
      console.error('[QubicaParser] Header parsing error:', error);
      throw error;
    }
  }

  private isTeamHeaderLine(line: string): boolean {
    if (!line || line.length < 42) return false;

    try {
      const laneStr = line.slice(0, 2);
      const teamStr = line.slice(6, 8);

      const isValid =
        /^\d{2}$/.test(laneStr.trim()) &&
        /^\d{1,2}$/.test(teamStr.trim());

      console.log('[QubicaParser] Team header check:', {
        line: line.slice(0, 42),
        laneNumber: laneStr,
        teamNumber: teamStr,
        isValid
      });

      return isValid;
    } catch (error) {
      console.error('[QubicaParser] Team header check error:', error);
      return false;
    }
  }

  private isBowlerLine(line: string): boolean {
    if (!line || line.length < 93) return false;

    try {
      const fields = {
        lane: line.slice(0, 2),
        position: line.slice(8, 10),
        bowlerId: line.slice(10, 14)
      };

      const isValid =
        /^\d{2}$/.test(fields.lane.trim()) &&
        /^\d{1,2}$/.test(fields.position.trim()) &&
        fields.bowlerId.trim().length > 0;

      console.log('[QubicaParser] Bowler line check:', {
        line: line.slice(0, 50) + '...',
        fields,
        isValid
      });

      return isValid;
    } catch (error) {
      console.error('[QubicaParser] Bowler line check error:', error);
      return false;
    }
  }

  private parseBowlerLine(line: string): QubicaBowlerScore | null {
    try {
      // Extract all fields first
      const fields = {
        lane: line.slice(0, 2).trim(),
        teamNumber: line.slice(6, 8).trim(),
        position: line.slice(8, 10).trim(),
        bowlerId: line.slice(10, 14).trim(),
        name: line.slice(20, 60).trim(),
        handicap: line.slice(62, 65).trim(),
        average: line.slice(66, 69).trim(),
        status: line.slice(88, 89).trim(),
        score: line.slice(90, 93).trim()
      };

      console.log('[QubicaParser] Bowler field extraction:', fields);

      // Parse numeric values
      const score = parseInt(fields.score) || 0;
      const handicap = parseInt(fields.handicap) || 0;
      const average = parseInt(fields.average) || 0;
      const position = parseInt(fields.position);
      const laneNumber = parseInt(fields.lane);

      if (isNaN(position) || isNaN(laneNumber)) {
        console.error('[QubicaParser] Invalid numeric fields:', {
          position: fields.position,
          lane: fields.lane
        });
        return null;
      }

      const bowlerScore: QubicaBowlerScore = {
        teamNumber: fields.teamNumber,
        gameNumber: 1,
        position,
        recordNumber: parseInt(fields.bowlerId) || 0,
        bowlerId: fields.bowlerId,
        status: {
          isVacant: fields.status === 'V' || fields.name.toUpperCase().includes('VACANT'),
          isAbsent: fields.status === 'A',
          isSub: fields.status === 'S'
        },
        score,
        laneNumber,
        bowlerName: fields.name,
        scoreSheet: '',
        handicap,
        average,
        hasBumpers: false
      };

      console.log('[QubicaParser] Parsed bowler:', {
        name: bowlerScore.bowlerName,
        team: bowlerScore.teamNumber,
        score: bowlerScore.score,
        position: bowlerScore.position
      });

      return bowlerScore;
    } catch (error) {
      console.error('[QubicaParser] Bowler parsing error:', error);
      return null;
    }
  }

  public parse(): QubicaScoreImport {
    console.log('[QubicaParser] Starting parse');

    const header = this.parseHeader();
    const games: QubicaTeamGame[] = [];
    const teamGames = new Map<string, Map<number, QubicaBowlerScore[]>>();

    let currentTeamNumber = '';
    let currentGameNumber = 1;
    let lastTeamComplete = true;

    // Skip header line
    this.currentIndex = 1;

    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex];

      if (!line || line.trim().length === 0) {
        if (lastTeamComplete) {
          currentGameNumber++;
          lastTeamComplete = false;
          console.log('[QubicaParser] Starting new game:', currentGameNumber);
        }
      } else if (this.isTeamHeaderLine(line)) {
        currentTeamNumber = line.slice(6, 8).trim();
        console.log('[QubicaParser] Found team:', currentTeamNumber);
        lastTeamComplete = true;
      } else if (this.isBowlerLine(line)) {
        const bowlerScore = this.parseBowlerLine(line);
        if (bowlerScore) {
          bowlerScore.gameNumber = currentGameNumber;
          const teamNumber = bowlerScore.teamNumber;

          if (!teamGames.has(teamNumber)) {
            teamGames.set(teamNumber, new Map());
          }

          const teamGameMap = teamGames.get(teamNumber)!;
          if (!teamGameMap.has(currentGameNumber)) {
            teamGameMap.set(currentGameNumber, []);
          }

          const bowlers = teamGameMap.get(currentGameNumber)!;
          bowlers.push(bowlerScore);

          if (bowlers.length === 4) {
            lastTeamComplete = true;
          }
        }
      }

      this.currentIndex++;
    }

    // Build games array
    for (const [teamNumber, teamGameMap] of teamGames) {
      for (const [gameNumber, bowlers] of teamGameMap) {
        if (bowlers.length > 0) {
          bowlers.sort((a, b) => a.position - b.position);
          const laneNumber = bowlers[0]?.laneNumber ?? 0;

          games.push({
            teamNumber,
            gameNumber,
            teamName: `Team ${teamNumber}`,
            laneNumber,
            bowlers
          });
        }
      }
    }

    // Sort games
    games.sort((a, b) => {
      if (a.laneNumber === b.laneNumber) {
        return a.gameNumber - b.gameNumber;
      }
      return a.laneNumber - b.laneNumber;
    });

    console.log('[QubicaParser] Parse complete:', {
      games: games.length,
      teams: teamGames.size,
      bowlers: games.reduce((sum, game) => sum + game.bowlers.length, 0),
      sampleGame: games[0] ? {
        team: games[0].teamNumber,
        lane: games[0].laneNumber,
        bowlers: games[0].bowlers.map(b => ({
          name: b.bowlerName,
          score: b.score
        }))
      } : 'No games found'
    });

    return { header, games };
  }
}

export const parseQubicaScoreFile = (fileContent: string): QubicaScoreImport => {
  const parser = new QubicaScoreParser(fileContent);
  return parser.parse();
};