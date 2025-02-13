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

  private parseBowlerScore(line: string): QubicaBowlerScore | null {
    const parts = line.split('\t');
    if (parts.length < 10) return null;

    const [
      teamNumber,
      gameNumber,
      position,
      recordNumber,
      bowlerId,
      status1,
      status2,
      score,
      laneNumber,
      bowlerName,
      scoreSheet,
      handicap,
      average,
      hasBumpers
    ] = parts;

    return {
      teamNumber,
      gameNumber: parseInt(gameNumber),
      position: parseInt(position),
      recordNumber: parseInt(recordNumber),
      bowlerId,
      status: {
        isVacant: status2 === 'V',
        isAbsent: status2 === 'A',
        isSub: status1 === 'S'
      },
      score: parseInt(score),
      laneNumber: parseInt(laneNumber),
      bowlerName,
      scoreSheet,
      handicap: parseInt(handicap),
      average: parseInt(average),
      hasBumpers: hasBumpers === 'Y'
    };
  }

  private parseTeamGame(startLine: string): QubicaTeamGame {
    const parts = startLine.split('\t');
    const teamNumber = parts[0];
    const gameNumber = parseInt(parts[1]);
    const laneNumber = parseInt(parts[8]);
    const teamName = parts[9];
    const bowlers: QubicaBowlerScore[] = [];

    // Skip the team header line
    this.currentIndex++;

    // Parse up to 4 bowlers
    for (let i = 0; i < 4; i++) {
      if (this.currentIndex >= this.lines.length) break;

      const line = this.lines[this.currentIndex];
      const bowlerScore = this.parseBowlerScore(line);

      if (bowlerScore && bowlerScore.teamNumber === teamNumber && 
          bowlerScore.gameNumber === gameNumber) {
        bowlers.push(bowlerScore);
        this.currentIndex++;
      }
    }

    return {
      teamNumber,
      gameNumber,
      teamName,
      laneNumber,
      bowlers
    };
  }

  public parse(): QubicaScoreImport {
    const header = this.parseHeader();
    const games: QubicaTeamGame[] = [];

    // Skip header and separator lines
    this.currentIndex = 2;

    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex];

      // Skip empty lines
      if (!line) {
        this.currentIndex++;
        continue;
      }

      // Check if this is a team header line
      if (line.includes('*\t*')) {
        const teamGame = this.parseTeamGame(line);
        games.push(teamGame);
      } else {
        this.currentIndex++;
      }
    }

    return { header, games };
  }
}

export const parseQubicaScoreFile = (fileContent: string): QubicaScoreImport => {
  const parser = new QubicaScoreParser(fileContent);
  return parser.parse();
};