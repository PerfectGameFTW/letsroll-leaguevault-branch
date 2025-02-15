import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '../../shared/schema.js';
import { parse } from 'date-fns';

export class QubicaScoreParser {
  private lines: string[];
  private currentIndex: number = 0;

  constructor(fileContent: string) {
    // Split on both \n and \r\n and filter out empty lines
    this.lines = fileContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    console.log(`[QubicaParser] Initialized with ${this.lines.length} non-empty lines`);

    // Debug first few lines to verify format
    this.lines.slice(0, 5).forEach((line, i) => {
      console.log(`[QubicaParser] Line ${i + 1}: ${line}`);
    });
  }

  private parseHeaderDate(headerLine: string): Date {
    console.log('[QubicaParser] Parsing header line for date:', headerLine);

    try {
      // Look for the date after "Week {number}"
      const weekPattern = /Week \d+/;
      const weekMatch = headerLine.match(weekPattern);
      if (!weekMatch) {
        throw new Error('Could not find week number in header');
      }

      // Extract the text after "Week XX" up to the next tab or end
      const afterWeek = headerLine.split(weekMatch[0])[1].trim();
      const dateStr = afterWeek.split('\t')[0].trim();
      console.log('[QubicaParser] Extracted date string:', dateStr);

      // Parse using date-fns with explicit format
      const parsedDate = parse(dateStr, 'MMMM d, yyyy', new Date());

      // Validate parsed date
      if (isNaN(parsedDate.getTime())) {
        throw new Error(`Invalid date value: ${dateStr}`);
      }

      // Ensure the date is set to midnight
      const normalizedDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());

      console.log('[QubicaParser] Successfully parsed date:', {
        original: dateStr,
        parsed: parsedDate.toISOString(),
        normalized: normalizedDate.toISOString(),
        year: normalizedDate.getFullYear(),
        month: normalizedDate.getMonth() + 1,
        day: normalizedDate.getDate()
      });

      return normalizedDate;
    } catch (error) {
      console.error('[QubicaParser] Error parsing date:', error);
      console.error('[QubicaParser] Header line:', headerLine);
      throw new Error(`Failed to parse date: ${error.message}`);
    }
  }

  private parseHeader(): QubicaScoreFileHeader {
    const headerLine = this.lines[0];
    console.log('[QubicaParser] Processing header line:', headerLine);

    if (!headerLine.startsWith('*')) {
      throw new Error('Invalid file format: Missing header line');
    }

    const parts = headerLine.split('\t');
    console.log('[QubicaParser] Header parts:', parts);

    // Parse the date from the full header line
    const date = this.parseHeaderDate(headerLine);

    const centerName = parts[1].replace(' (QubicaAMF)', '');
    const leagueName = parts[2];
    const weekStr = parts[3];
    const sessionTime = parts[4];
    const leagueId = parts[5];
    const description = parts[6] || '';

    // Parse week number
    const weekNumber = parseInt(weekStr.replace('Week ', ''));
    if (isNaN(weekNumber)) {
      throw new Error('Invalid week number format');
    }

    const header = {
      date,
      centerName,
      leagueName,
      weekNumber,
      sessionTime,
      leagueId,
      description
    };

    console.log('[QubicaParser] Successfully parsed header:', {
      date: header.date.toISOString(),
      weekNumber: header.weekNumber,
      leagueName: header.leagueName
    });

    return header;
  }

  private isTeamHeaderLine(line: string): boolean {
    if (!line) return false;

    // First try splitting by tab
    let parts = line.split('\t');
    if (parts.length === 1) {
      // If no tabs found, try splitting by multiple spaces
      parts = line.split(/\s+/);
    }

    parts = parts.map(p => p.trim());

    // Team headers should have:
    // 1. First part is 3 digits (team number)
    // 2. Second part is game number (1-3)
    // 3. Third part is "0" (position)
    const isHeader =
      /^\d{3}$/.test(parts[0]) &&
      /^[1-3]$/.test(parts[1]) &&
      parts[2] === '0';

    if (isHeader) {
      console.log('[QubicaParser] Found team header:', {
        teamNumber: parts[0],
        gameNumber: parts[1],
        position: parts[2]
      });
    }

    return isHeader;
  }

  private parseLine(line: string): [string, number, string, string, number] | null {
    if (!line) return null;

    // First try splitting by tab
    let parts = line.split('\t');
    if (parts.length === 1) {
      // If no tabs found, try splitting by multiple spaces
      parts = line.split(/\s+/);
    }

    parts = parts.map(p => p.trim());

    if (parts.length < 10) {
      return null;
    }

    const teamNumber = parts[0];
    const gameNumber = parseInt(parts[1]);
    const position = parts[2];
    const recordNumber = parts[3];
    const laneNumber = parseInt(parts[8]);

    // Additional validation checks
    if (!teamNumber || !gameNumber || !position || !recordNumber || !laneNumber) {
      return null;
    }

    if (isNaN(gameNumber) || gameNumber < 1 || gameNumber > 3) {
      return null;
    }

    return [teamNumber, gameNumber, position, recordNumber, laneNumber];
  }

  private parseBowlerScore(line: string): QubicaBowlerScore | null {
    const lineInfo = this.parseLine(line);
    if (!lineInfo) {
      return null;
    }

    const [teamNumber, gameNumber, position, recordNumber, laneNumber] = lineInfo;

    // First try splitting by tab
    let parts = line.split('\t');
    if (parts.length === 1) {
      // If no tabs found, try splitting by multiple spaces
      parts = line.split(/\s+/);
    }

    parts = parts.map(p => p.trim());

    const bowlerId = parts[4];
    const status1 = parts[5];
    const status2 = parts[6];
    const score = parseInt(parts[7]);
    const bowlerName = parts[9];
    const scoreSheet = parts[10] || '';
    const handicap = parseInt(parts[11] || '0');
    const average = parseInt(parts[12] || '0');

    // Additional validation
    if (!bowlerId || isNaN(score)) {
      return null;
    }

    if (isNaN(score) || score < 0 || score > 300) {
      return null;
    }

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
      score,
      laneNumber,
      bowlerName,
      scoreSheet,
      handicap: isNaN(handicap) ? 0 : handicap,
      average: isNaN(average) ? 0 : average,
      hasBumpers: false
    };
  }

  private parseTeam(startLine: string): QubicaTeamGame[] {
    const lineInfo = this.parseLine(startLine);
    if (!lineInfo) return [];

    const [teamNumber, gameNumber, _position, _recordNumber, laneNumber] = lineInfo;

    // First try splitting by tab
    let parts = startLine.split('\t');
    if (parts.length === 1) {
      // If no tabs found, try splitting by multiple spaces
      parts = startLine.split(/\s+/);
    }
    parts = parts.map(p => p.trim());

    const teamName = parts[9];

    const teamGames: QubicaTeamGame[] = [];
    const gameScores: Map<number, QubicaBowlerScore[]> = new Map();

    // Start from the next line
    this.currentIndex++;

    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex];

      if (!line || this.isTeamHeaderLine(line)) {
        break;
      }

      const bowlerScore = this.parseBowlerScore(line);
      if (bowlerScore) {
        const scores = gameScores.get(bowlerScore.gameNumber) || [];
        scores.push(bowlerScore);
        gameScores.set(bowlerScore.gameNumber, scores);
      }

      this.currentIndex++;
    }

    // Create team games for each game number with scores
    for (const [gameNum, bowlers] of gameScores) {
      if (bowlers.length > 0) {
        teamGames.push({
          teamNumber,
          gameNumber: gameNum,
          teamName,
          laneNumber,
          bowlers: bowlers.sort((a, b) => a.position - b.position)
        });
      }
    }

    return teamGames;
  }

  public parse(): QubicaScoreImport {
    console.log('[QubicaParser] Starting to parse score file');
    const header = this.parseHeader();
    console.log('[QubicaParser] Successfully parsed header. Date:', header.date.toISOString());

    const games: QubicaTeamGame[] = [];
    this.currentIndex = 2;

    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex];
      if (!line) {
        this.currentIndex++;
        continue;
      }

      if (this.isTeamHeaderLine(line)) {
        const teamGames = this.parseTeam(line);
        games.push(...teamGames);
      }
      this.currentIndex++;
    }

    return { header, games };
  }
}

export const parseQubicaScoreFile = (fileContent: string): QubicaScoreImport => {
  const parser = new QubicaScoreParser(fileContent);
  return parser.parse();
};