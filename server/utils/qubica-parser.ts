import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '../../shared/schema.js';

export class QubicaScoreParser {
    private lines: string[];
    private currentIndex: number = 0;

    constructor(fileContent: string) {
      // Split by newlines and handle both Unix and Windows line endings
      this.lines = fileContent.split(/\r?\n/).map(line => line.trim());
      console.log('[QubicaParser] Processing file with', this.lines.length, 'lines');
    }

    private parseHeader(): QubicaScoreFileHeader {
      if (this.lines.length === 0) {
        throw new Error('Empty file provided');
      }

      const headerLine = this.lines[0];
      if (!headerLine.startsWith('*')) {
        throw new Error('Invalid header format: header must start with *');
      }

      console.log('[QubicaParser] Parsing header line:', headerLine);
      const parts = headerLine.split('\t');

      if (parts.length < 5) {
        throw new Error('Invalid header format: missing required fields');
      }

      // Format example: "* 12/30/1899 12:00 am\tConqueror X (QubicaAMF)\tFarmington Mixed 24/25\tWeek 20\tFebruary 3, 2025  18:30\t365879\tTest Import"
      const firstPart = parts[0].substring(2); // Remove '* ' prefix
      const centerName = parts[1].replace(' (QubicaAMF)', '');
      const leagueName = parts[2];
      const weekStr = parts[3];
      const dateTimeStr = parts[4];
      const leagueId = parts[5];
      const description = parts[6] || '';

      // Parse week number
      const weekMatch = weekStr.match(/Week\s+(\d+)/i);
      if (!weekMatch) {
        throw new Error('Invalid week number format');
      }
      const weekNumber = parseInt(weekMatch[1]);

      // Parse date and time
      const [datePart, timePart] = dateTimeStr.trim().split(/\s+(?=\d{2}:\d{2}$)/);
      const date = new Date(datePart);
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date format');
      }

      console.log('[QubicaParser] Parsed header:', {
        date,
        centerName,
        leagueName,
        weekNumber,
        leagueId,
        description
      });

      return {
        date,
        centerName,
        leagueName,
        weekNumber,
        sessionTime: timePart || '18:30',
        leagueId,
        description
      };
    }

    private isTeamHeaderLine(line: string): boolean {
      if (!line) return false;
      const parts = line.split('\t');
      console.log('[QubicaParser] Checking team header line:', line);
      // Team headers have a valid team number and game number
      return parts.length >= 10 && !isNaN(parseInt(parts[0])) && !isNaN(parseInt(parts[1]));
    }

    private parseLine(line: string): [string, number, string, string, number] | null {
      const parts = line.split('\t');
      if (parts.length < 10) {
        console.log('[QubicaParser] Invalid line format:', line);
        return null;
      }

      const teamNumber = parts[0];
      const gameNumber = parseInt(parts[1]);
      const position = parts[2];
      const recordNumber = parts[3];
      const laneNumber = parseInt(parts[8]);

      console.log('[QubicaParser] Parsed line:', {
        teamNumber,
        gameNumber,
        position,
        recordNumber,
        laneNumber
      });

      if (isNaN(gameNumber) || gameNumber < 1 || gameNumber > 3) {
        console.log('[QubicaParser] Invalid game number:', gameNumber);
        return null;
      }

      return [teamNumber, gameNumber, position, recordNumber, laneNumber];
    }

    private parseBowlerScore(line: string): QubicaBowlerScore | null {
      const lineInfo = this.parseLine(line);
      if (!lineInfo) return null;

      const [teamNumber, gameNumber, position, recordNumber, laneNumber] = lineInfo;
      const parts = line.split('\t');

      const [
        _teamNumber,
        _gameNumber,
        _position,
        _recordNumber,
        bowlerId,
        status1,
        status2,
        score,
        _laneNumber,
        bowlerName,
        scoreSheet,
        handicap,
        average,
        hasBumpers
      ] = parts;

      const parsedScore = parseInt(score);
      if (isNaN(parsedScore) || parsedScore < 0) {
        console.log('[QubicaParser] Invalid score value:', score);
        return null;
      }

      console.log(`[QubicaParser] Parsed bowler score: ${bowlerName} (ID: ${bowlerId}) - Score: ${parsedScore}`);

      return {
        teamNumber,
        gameNumber,
        position: parseInt(position),
        recordNumber: parseInt(recordNumber),
        bowlerId,
        status: {
          isVacant: status2 === 'V',
          isAbsent: status2 === 'A',
          isSub: status1 === 'S'
        },
        score: parsedScore,
        laneNumber,
        bowlerName,
        scoreSheet,
        handicap: parseInt(handicap) || 0,
        average: parseInt(average) || 0,
        hasBumpers: hasBumpers === 'Y'
      };
    }

    private parseTeam(startLine: string): QubicaTeamGame[] {
      const lineInfo = this.parseLine(startLine);
      if (!lineInfo) return [];

      const [teamNumber, gameNumber, _position, _recordNumber, laneNumber] = lineInfo;
      const parts = startLine.split('\t');
      const teamName = parts[9];

      console.log(`[QubicaParser] Parsing team: ${teamName} (Number: ${teamNumber})`);

      // Parse all lines until we hit another team header or end of file
      const bowlers: QubicaBowlerScore[] = [];
      const bowlerScore = this.parseBowlerScore(startLine);
      if (bowlerScore) {
        bowlers.push(bowlerScore);
      }

      if (bowlers.length > 0) {
        console.log(`[QubicaParser] Team ${teamName} - Game ${gameNumber}: ${bowlers.length} bowlers`);
        return [{
          teamNumber,
          gameNumber,
          teamName,
          laneNumber,
          bowlers
        }];
      }

      return [];
    }

    public parse(): QubicaScoreImport {
      console.log('[QubicaParser] Starting parse process...');
      const header = this.parseHeader();
      const games: QubicaTeamGame[] = [];

      // Skip header line
      this.currentIndex = 1;

      // Parse all teams
      while (this.currentIndex < this.lines.length) {
        const line = this.lines[this.currentIndex];

        // Skip empty lines
        if (!line) {
          this.currentIndex++;
          continue;
        }

        // Parse team if we hit a team header
        if (this.isTeamHeaderLine(line)) {
          console.log('[QubicaParser] Found team header line:', line);
          const teamGames = this.parseTeam(line);
          games.push(...teamGames);
        }

        this.currentIndex++;
      }

      // Log game distribution for verification
      const gameDistribution = games.reduce((acc, game) => {
        acc[game.gameNumber] = (acc[game.gameNumber] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);

      console.log('[QubicaParser] Game distribution:', gameDistribution);
      console.log('[QubicaParser] Total games parsed:', games.length);
      console.log('[QubicaParser] Parsed games:', JSON.stringify(games, null, 2));

      return { header, games };
    }
  }

  export const parseQubicaScoreFile = (fileContent: string): QubicaScoreImport => {
    console.log('[QubicaParser] Starting score file parse');
    const parser = new QubicaScoreParser(fileContent);
    return parser.parse();
  };