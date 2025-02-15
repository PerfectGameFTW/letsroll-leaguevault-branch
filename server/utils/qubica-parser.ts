import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '../../shared/schema.js';

export class QubicaScoreParser {
  private lines: string[];
  private currentIndex: number = 0;

  constructor(fileContent: string) {
    this.lines = fileContent.split('\n').map(line => line.trim());
  }

  private parseHeader(): QubicaScoreFileHeader {
    const headerLine = this.lines[0];
    console.log('[QubicaParser] Parsing header line:', headerLine);

    // Support both legacy and new QubicaAMF formats
    if (headerLine.startsWith('*')) {
      return this.parseLegacyHeader(headerLine);
    } else {
      return this.parseModernHeader(headerLine);
    }
  }

  private parseLegacyHeader(headerLine: string): QubicaScoreFileHeader {
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
      throw new Error('Invalid week number format in legacy header');
    }

    // Parse date and time
    const [datePart, timePart] = dateTimeStr.trim().split(/\s+(?=\d{2}:\d{2}$)/);
    const date = new Date(datePart);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date format in legacy header');
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

  private parseModernHeader(headerLine: string): QubicaScoreFileHeader {
    console.log('[QubicaParser] Parsing modern format header');

    // Modern format parsing (format documented in header comments)
    // Example: "110004LBLS-2025JB_Webb_Jervis B. Webb 24/25"
    try {
      // Extract league name from the header line
      const leagueNameMatch = headerLine.match(/LBLS-\d{4}(.+?)(?:\s+\d{2}\/\d{2}|$)/);
      const leagueName = leagueNameMatch ? leagueNameMatch[1].trim() : 'Unknown League';

      // Extract or determine other required fields
      const date = new Date(); // Current date as fallback
      const centerName = "Bowling Center"; // Default center name

      // Try to extract week number from filename or content
      let weekNumber = 1;
      for (let i = 0; i < this.lines.length && i < 10; i++) {
        const weekMatch = this.lines[i].match(/Week\s+(\d+)/i);
        if (weekMatch) {
          weekNumber = parseInt(weekMatch[1]);
          break;
        }
      }

      // Extract league ID if present in the format
      const leagueIdMatch = headerLine.match(/^(\d{6})/);
      const leagueId = leagueIdMatch ? leagueIdMatch[1] : '';

      console.log('[QubicaParser] Parsed modern header:', {
        leagueName,
        weekNumber,
        leagueId
      });

      return {
        date,
        centerName,
        leagueName,
        weekNumber,
        sessionTime: '18:30',
        leagueId,
        description: ''
      };
    } catch (error) {
      console.error('[QubicaParser] Error parsing modern header:', error);
      throw new Error(`Failed to parse modern format header: ${error.message}`);
    }
  }

  private isTeamHeaderLine(line: string): boolean {
    const parts = line.split('\t');
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

    const teamGames: QubicaTeamGame[] = [];
    const gameScores: Map<number, QubicaBowlerScore[]> = new Map();

    this.currentIndex++;
    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex];

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
    console.log('[QubicaParser] Starting to parse score file');
    const header = this.parseHeader();
    console.log('[QubicaParser] Successfully parsed header:', header);

    const games: QubicaTeamGame[] = [];

    // Skip header and separator lines
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