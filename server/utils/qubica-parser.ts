import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '../../shared/schema.js';
import { parse } from 'date-fns';

export class QubicaScoreParser {
  private lines: string[];
  private currentIndex: number = 0;

  constructor(fileContent: string) {
    this.lines = fileContent.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    console.log(`[QubicaParser] Initialized with ${this.lines.length} non-empty lines`);
  }

  private parseHeaderDate(headerLine: string): Date {
    console.log('[QubicaParser] Raw header line:', headerLine);

    try {
      // Match "Week XX" followed by "MonthName DD, YYYY HH:mm" pattern
      const dateTimePattern = /Week\s*\d+.*?([A-Za-z]+\s+\d{1,2},\s*\d{4})\s*(\d{1,2}:\d{2})/;
      const match = headerLine.match(dateTimePattern);

      if (!match) {
        console.error('[QubicaParser] No date/time pattern found in header line');
        console.log('[QubicaParser] Header line details:', {
          raw: headerLine,
          length: headerLine.length,
          pattern: dateTimePattern.toString()
        });
        throw new Error('Could not find date pattern in header');
      }

      const [_, dateStr, timeStr] = match;
      console.log('[QubicaParser] Matched components:', {
        dateStr,
        timeStr
      });

      // Parse the date portion using date-fns
      const parsedDate = parse(dateStr.trim(), 'MMMM d, yyyy', new Date());

      if (isNaN(parsedDate.getTime())) {
        console.error('[QubicaParser] Failed to parse date:', {
          input: dateStr,
          output: parsedDate
        });
        throw new Error(`Invalid date value: ${dateStr}`);
      }

      // Add the time portion
      if (timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        parsedDate.setHours(hours, minutes, 0, 0);
      }

      console.log('[QubicaParser] Successfully parsed date:', {
        input: `${dateStr} ${timeStr}`,
        output: parsedDate.toISOString(),
        components: {
          year: parsedDate.getFullYear(),
          month: parsedDate.getMonth() + 1,
          day: parsedDate.getDate(),
          hours: parsedDate.getHours(),
          minutes: parsedDate.getMinutes()
        }
      });

      return parsedDate;
    } catch (error) {
      console.error('[QubicaParser] Error parsing header date:', {
        error: error instanceof Error ? {
          type: error.constructor.name,
          message: error.message,
          stack: error.stack
        } : error,
        headerLine
      });
      throw error;
    }
  }

  private parseHeader(): QubicaScoreFileHeader {
    const headerLine = this.lines[0];
    console.log('[QubicaParser] Processing header line:', headerLine);

    if (!headerLine.startsWith('*')) {
      throw new Error('Invalid file format: Missing header line');
    }

    // First try splitting by tab
    const allParts = headerLine.split('\t');
    const firstPart = allParts[0];

    if (!firstPart) {
      throw new Error('Invalid header format: Empty first part');
    }

    console.log('[QubicaParser] Header parts:', allParts);

    // Parse the date from the full header line
    const date = this.parseHeaderDate(headerLine);

    // Extract center name and other fields from the header parts
    let centerName = '';
    let leagueName = '';
    let weekStr = '';
    let sessionTime = '';
    let leagueId = '';
    let description = '';

    if (allParts.length >= 2) {
      // Format with tabs
      centerName = allParts[1].replace(' (QubicaAMF)', '');
      leagueName = allParts[2] || '';
      weekStr = allParts[3] || '';
      sessionTime = allParts[4] || '';
      leagueId = allParts[5] || '';
      description = allParts[6] || '';
    } else {
      // Fallback to space-based parsing if no tabs found
      const spaceParts = firstPart.split(' (QubicaAMF)');
      if (spaceParts.length >= 2) {
        centerName = spaceParts[0].replace('* ', '');
        const remainingParts = spaceParts[1].trim().split(/\s+/);
        leagueName = remainingParts[0] || '';
        weekStr = remainingParts.find(p => p.startsWith('Week')) || '';
        sessionTime = remainingParts.find(p => p.includes(':')) || '';
        leagueId = remainingParts[remainingParts.length - 2] || '';
        description = remainingParts[remainingParts.length - 1] || '';
      }
    }

    // Parse week number
    const weekMatch = weekStr.match(/Week\s*(\d+)/);
    const weekNumber = weekMatch ? parseInt(weekMatch[1]) : 0;

    if (isNaN(weekNumber)) {
      console.error('[QubicaParser] Invalid week number format:', weekStr);
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
      leagueName: header.leagueName,
      centerName: header.centerName
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
    this.currentIndex = 1; //Corrected index to start from the second line after header

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