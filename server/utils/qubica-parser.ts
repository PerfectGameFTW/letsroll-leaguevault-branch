import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '../../shared/schema.js';

export class QubicaScoreParser {
  private lines: string[];
  private currentIndex: number = 0;

  constructor(fileContent: string) {
    this.lines = fileContent.split('\n').map(line => line.trim());
  }

  private parseHeader(): QubicaScoreFileHeader {
    const headerLine = this.lines[0];
    if (!headerLine.startsWith('*')) {
      throw new Error('Invalid header format: header must start with *');
    }

    const parts = headerLine.split('\t');

    // Format example: "* 12/30/1899 12:00 am\tConqueror X (QubicaAMF)\tFarmington Mixed 24/25\tWeek 20\tFebruary 3, 2025  18:30\t365879\tMichael Shearer, Perfect Game"
    const firstPart = parts[0].substring(2); // Remove '* ' prefix
    const centerName = parts[1].replace(' (QubicaAMF)', '');
    const leagueName = parts[2];
    const weekStr = parts[3];
    const dateTimeStr = parts[4];
    const leagueId = parts[5];
    const description = parts[6] || '';

    // Parse week number
    const weekNumber = parseInt(weekStr.replace('Week ', ''));
    if (isNaN(weekNumber)) {
      throw new Error('Invalid week number format');
    }

    // Parse date and time
    const [datePart, timePart] = dateTimeStr.trim().split(/\s+(?=\d{2}:\d{2}$)/);
    const date = new Date(datePart);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date format');
    }

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
    const parts = line.split('\t');
    // Team headers have position "0" in the third column
    return parts.length >= 10 && parts[2] === '0';
  }

  private parseLine(line: string): [string, number, string, string, number] | null {
    const parts = line.split('\t');
    if (parts.length < 10) return null;

    const teamNumber = parts[0];
    const gameNumber = parseInt(parts[1]);
    const position = parts[2];
    const recordNumber = parts[3];
    const laneNumber = parseInt(parts[8]);

    if (isNaN(gameNumber) || gameNumber < 1 || gameNumber > 3) {
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
      score: parseInt(score),
      laneNumber,
      bowlerName,
      scoreSheet,
      handicap: parseInt(handicap),
      average: parseInt(average),
      hasBumpers: hasBumpers === 'Y'
    };
  }

  private parseTeam(startLine: string): QubicaTeamGame[] {
    const lineInfo = this.parseLine(startLine);
    if (!lineInfo) return [];

    const [teamNumber, gameNumber, _position, _recordNumber, laneNumber] = lineInfo;
    const parts = startLine.split('\t');
    const teamName = parts[9];

    // Will hold all games for this team
    const teamGames: QubicaTeamGame[] = [];
    const gameScores: Map<number, QubicaBowlerScore[]> = new Map();

    // Parse all lines until we hit another team header or end of file
    this.currentIndex++;
    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex];

      // Stop if we hit another team header or empty line
      if (!line || this.isTeamHeaderLine(line)) {
        break;
      }

      const bowlerScore = this.parseBowlerScore(line);
      if (bowlerScore && bowlerScore.teamNumber === teamNumber) {
        const scores = gameScores.get(bowlerScore.gameNumber) || [];
        scores.push(bowlerScore);
        gameScores.set(bowlerScore.gameNumber, scores);
      }

      this.currentIndex++;
    }

    // Create team games for each game number
    for (const [gameNum, bowlers] of gameScores) {
      if (bowlers.length > 0) {
        teamGames.push({
          teamNumber,
          gameNumber: gameNum,
          teamName,
          laneNumber,
          bowlers
        });
      }
    }

    return teamGames;
  }

  public parse(): QubicaScoreImport {
    const header = this.parseHeader();
    const games: QubicaTeamGame[] = [];

    // Skip header and separator lines
    this.currentIndex = 2;

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
        const teamGames = this.parseTeam(line);
        games.push(...teamGames);
      } else {
        this.currentIndex++;
      }
    }

    // Log game distribution for verification
    const gameDistribution = games.reduce((acc, game) => {
      acc[game.gameNumber] = (acc[game.gameNumber] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    console.log('[QubicaParser] Game distribution:', gameDistribution);

    return { header, games };
  }
}

export const parseQubicaScoreFile = (fileContent: string): QubicaScoreImport => {
  const parser = new QubicaScoreParser(fileContent);
  return parser.parse();
};