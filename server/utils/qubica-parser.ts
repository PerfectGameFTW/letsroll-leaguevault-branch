import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '@shared/schema';

export class QubicaParser {
  private lines: string[];
  private currentIndex: number = 0;

  constructor(fileContent: string) {
    // Split while preserving whitespace and line endings
    this.lines = fileContent.split(/\r?\n/);
    console.log(`[QubicaParser] Initialized with ${this.lines.length} lines`);

    // Log raw file content for debugging
    console.log('[QubicaParser] Raw file content sample:', {
      totalLines: this.lines.length,
      firstLines: this.lines.slice(0, 5).map(line => ({
        content: line,
        length: line.length,
        charCodes: Array.from(line.slice(0, 20)).map(c => c.charCodeAt(0)),
        hexDump: Array.from(line.slice(0, 20)).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ')
      }))
    });
  }

  private parseHeader(): QubicaScoreFileHeader {
    const line = this.lines[0];
    console.log('[QubicaParser] Processing header line:', line);

    if (!line || line.length < 104) {
      throw new Error(`Invalid header line length: ${line?.length ?? 0}, expected at least 104`);
    }

    try {
      // Extract and validate header fields
      const fields = {
        leagueId: line.slice(0, 6),
        leagueName: line.slice(20, 60),
        weekInfo: line.slice(80, 86),
        dateTime: line.slice(92, 104)
      };

      console.log('[QubicaParser] Header fields:', {
        raw: fields,
        parsed: {
          leagueId: fields.leagueId.trim(),
          leagueName: fields.leagueName.trim(),
          weekNumber: parseInt(line.slice(84, 86).trim()),
          dateComponents: {
            year: fields.dateTime.slice(0, 4),
            month: fields.dateTime.slice(4, 6),
            day: fields.dateTime.slice(6, 8),
            hour: fields.dateTime.slice(8, 10),
            minute: fields.dateTime.slice(10, 12)
          }
        }
      });

      const weekNumber = parseInt(line.slice(84, 86).trim()) || 1;
      const dateInfo = {
        year: parseInt(fields.dateTime.slice(0, 4)),
        month: parseInt(fields.dateTime.slice(4, 6)),
        day: parseInt(fields.dateTime.slice(6, 8)),
        hour: parseInt(fields.dateTime.slice(8, 10)),
        minute: parseInt(fields.dateTime.slice(10, 12))
      };

      console.log('[QubicaParser] Date components:', dateInfo);

      // Construct date with validation
      let date = new Date();
      if (!isNaN(dateInfo.year) && dateInfo.year > 2020 &&
          !isNaN(dateInfo.month) && dateInfo.month >= 1 && dateInfo.month <= 12 &&
          !isNaN(dateInfo.day) && dateInfo.day >= 1 && dateInfo.day <= 31) {
        date = new Date(
          dateInfo.year,
          dateInfo.month - 1,
          dateInfo.day,
          dateInfo.hour || 0,
          dateInfo.minute || 0
        );
      }

      return {
        date,
        centerName: "Bonnie Lanes",
        leagueName: fields.leagueName.trim() || 'Unknown League',
        weekNumber,
        sessionTime: `${dateInfo.hour || 0}:${dateInfo.minute || 0}`,
        leagueId: fields.leagueId.trim(),
        description: line.slice(60, 90).trim()
      };
    } catch (error) {
      console.error('[QubicaParser] Header parsing error:', {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        line,
        length: line.length
      });
      throw error;
    }
  }

  private isTeamHeaderLine(line: string): boolean {
    if (!line || line.length < 42) {
      console.log('[QubicaParser] Line too short for team header:', {
        length: line?.length,
        required: 42
      });
      return false;
    }

    try {
      const segments = {
        lane: line.slice(0, 2).trim(),
        teamNumber: line.slice(6, 8).trim()
      };

      const isValid = /^\d{2}$/.test(segments.lane) && /^\d{1,2}$/.test(segments.teamNumber);

      console.log('[QubicaParser] Team header validation:', {
        line: line.slice(0, 42),
        segments,
        isValid,
        validation: {
          laneValid: /^\d{2}$/.test(segments.lane),
          teamValid: /^\d{1,2}$/.test(segments.teamNumber)
        }
      });

      return isValid;
    } catch (error) {
      console.error('[QubicaParser] Team header check error:', error);
      return false;
    }
  }

  private isBowlerLine(line: string): boolean {
    if (!line || line.length < 93) {
      console.log('[QubicaParser] Line too short for bowler:', {
        length: line?.length,
        required: 93
      });
      return false;
    }

    try {
      const segments = {
        lane: line.slice(0, 2).trim(),
        position: line.slice(8, 10).trim(),
        bowlerId: line.slice(10, 14).trim()
      };

      const isValid = 
        /^\d{2}$/.test(segments.lane) &&
        /^\d{1,2}$/.test(segments.position) &&
        segments.bowlerId.length > 0;

      console.log('[QubicaParser] Bowler line validation:', {
        line: line.slice(0, 50) + '...',
        segments,
        isValid,
        validation: {
          laneValid: /^\d{2}$/.test(segments.lane),
          positionValid: /^\d{1,2}$/.test(segments.position),
          hasId: segments.bowlerId.length > 0
        }
      });

      return isValid;
    } catch (error) {
      console.error('[QubicaParser] Bowler line check error:', error);
      return false;
    }
  }

  private parseBowlerLine(line: string): QubicaBowlerScore | null {
    try {
      // Extract fixed-width fields
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

      console.log('[QubicaParser] Bowler field extraction:', {
        raw: fields,
        parsed: {
          lane: parseInt(fields.lane),
          teamNumber: parseInt(fields.teamNumber),
          position: parseInt(fields.position),
          score: parseInt(fields.score),
          handicap: parseInt(fields.handicap),
          average: parseInt(fields.average)
        }
      });

      // Parse numeric values and remove leading zeros from team number
      const score = parseInt(fields.score) || 0;
      const handicap = parseInt(fields.handicap) || 0;
      const average = parseInt(fields.average) || 0;
      const position = parseInt(fields.position);
      const laneNumber = parseInt(fields.lane);
      // Convert team number to integer by removing leading zeros
      const teamNumber = String(parseInt(fields.teamNumber) || 0);

      if (isNaN(position) || isNaN(laneNumber)) {
        console.error('[QubicaParser] Invalid numeric fields:', {
          position: fields.position,
          lane: fields.lane,
          teamNumber
        });
        return null;
      }

      // Initialize required arrays for database schema
      const frames: string[] = [];
      const splits: string[] = [];
      const notes: string[] = [];

      const bowlerScore: QubicaBowlerScore = {
        teamNumber,
        gameNumber: 1, // This will be set correctly later
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
        hasBumpers: false,
        frames,
        splits,
        notes
      };

      return bowlerScore;
    } catch (error) {
      console.error('[QubicaParser] Bowler parsing error:', {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        line: line.slice(0, 50) + '...'
      });
      return null;
    }
  }

  public parse(): QubicaScoreImport {
    console.log('[QubicaParser] Starting parse process');
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
        console.log('[QubicaParser] Found team header:', {
          teamNumber: currentTeamNumber,
          line: line.slice(0, 42),
          currentGameNumber
        });
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

          console.log('[QubicaParser] Added bowler:', {
            name: bowlerScore.bowlerName,
            team: teamNumber,
            game: currentGameNumber,
            position: bowlerScore.position,
            score: bowlerScore.score
          });

          if (bowlers.length === 4) {
            lastTeamComplete = true;
            console.log('[QubicaParser] Team complete:', {
              teamNumber,
              gameNumber: currentGameNumber,
              bowlerCount: bowlers.length
            });
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

          console.log('[QubicaParser] Created game:', {
            team: teamNumber,
            game: gameNumber,
            lane: laneNumber,
            bowlers: bowlers.map(b => ({
              name: b.bowlerName,
              position: b.position,
              score: b.score
            }))
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
      header: {
        ...header,
        date: header.date.toISOString()
      },
      totalGames: games.length,
      teamCount: teamGames.size,
      totalBowlers: games.reduce((sum, game) => sum + game.bowlers.length, 0),
      gameNumbers: [...new Set(games.map(g => g.gameNumber))],
      sampleGame: games[0] ? {
        team: games[0].teamNumber,
        lane: games[0].laneNumber,
        bowlers: games[0].bowlers.map(b => ({
          name: b.bowlerName,
          score: b.score,
          position: b.position
        }))
      } : 'No games found'
    });

    return { header, games };
  }
}

export const parseQubicaScoreFile = (fileContent: string): QubicaScoreImport => {
  const parser = new QubicaParser(fileContent);
  return parser.parse();
};