import { QubicaScoreFileHeader, QubicaBowlerScore, QubicaTeamGame, QubicaScoreImport } from '../../shared/schema.js';

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

  private isTeamHeaderLine(line: string): boolean {
    if (!line) return false;

    // First try splitting by tab
    let parts = line.split('\t');
    if (parts.length === 1) {
      // If no tabs found, try splitting by multiple spaces
      parts = line.split(/\s+/);
    }

    parts = parts.map(p => p.trim());

    console.log('[QubicaParser] Checking team header line:', {
      line,
      partsLength: parts.length,
      firstPart: parts[0],
      secondPart: parts[1],
      thirdPart: parts[2]
    });

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
      console.log('[QubicaParser] Skipping line with insufficient columns:', line);
      return null;
    }

    const teamNumber = parts[0];
    const gameNumber = parseInt(parts[1]);
    const position = parts[2];
    const recordNumber = parts[3];
    const laneNumber = parseInt(parts[8]);

    if (isNaN(gameNumber) || gameNumber < 1 || gameNumber > 3) {
      console.log('[QubicaParser] Invalid game number:', gameNumber);
      return null;
    }

    return [teamNumber, gameNumber, position, recordNumber, laneNumber];
  }

  private parseBowlerScore(line: string): QubicaBowlerScore | null {
    console.log('[QubicaParser] Parsing bowler score line:', line);

    const lineInfo = this.parseLine(line);
    if (!lineInfo) return null;

    const [teamNumber, gameNumber, position, recordNumber, laneNumber] = lineInfo;

    // First try splitting by tab
    let parts = line.split('\t');
    if (parts.length === 1) {
      // If no tabs found, try splitting by multiple spaces
      parts = line.split(/\s+/);
    }

    parts = parts.map(p => p.trim());

    if (parts.length < 13) {
      console.log('[QubicaParser] Score line has insufficient columns:', parts.length);
      return null;
    }

    const bowlerId = parts[4];
    const status1 = parts[5];
    const status2 = parts[6];
    const score = parseInt(parts[7]);
    const bowlerName = parts[9];
    const scoreSheet = parts[10] || '';
    const handicap = parseInt(parts[11] || '0');
    const average = parseInt(parts[12] || '0');

    if (isNaN(score) || score < 0 || score > 300) {
      console.log('[QubicaParser] Invalid score value:', score);
      return null;
    }

    const bowlerScore = {
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

    console.log('[QubicaParser] Parsed bowler score:', {
      bowlerName: bowlerScore.bowlerName,
      score: bowlerScore.score,
      gameNumber: bowlerScore.gameNumber,
      position: bowlerScore.position
    });

    return bowlerScore;
  }

  private parseTeam(startLine: string): QubicaTeamGame[] {
    console.log('[QubicaParser] Starting team parse with line:', startLine);

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

    console.log('[QubicaParser] Parsing team:', {
      teamNumber,
      teamName,
      gameNumber,
      laneNumber
    });

    const teamGames: QubicaTeamGame[] = [];
    const gameScores: Map<number, QubicaBowlerScore[]> = new Map();

    // Start from the next line
    this.currentIndex++;

    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex];

      if (!line || this.isTeamHeaderLine(line)) {
        console.log('[QubicaParser] End of team section or new team header found');
        break;
      }

      const bowlerScore = this.parseBowlerScore(line);
      if (bowlerScore) {
        const scores = gameScores.get(bowlerScore.gameNumber) || [];
        scores.push(bowlerScore);
        gameScores.set(bowlerScore.gameNumber, scores);
        console.log('[QubicaParser] Added score for', bowlerScore.bowlerName, 
          'game', bowlerScore.gameNumber, 'score', bowlerScore.score);
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
        console.log('[QubicaParser] Created game', gameNum, 'for team', teamName, 
          'with', bowlers.length, 'bowlers');
      }
    }

    return teamGames;
  }

  private parseHeader(): QubicaScoreFileHeader {
    const headerLine = this.lines[0];
    console.log('[QubicaParser] Parsing header line:', headerLine);

    if (!headerLine.startsWith('*')) {
      throw new Error('Invalid file format: Missing header line');
    }

    const parts = headerLine.split('\t');

    // Format example: "* 12/30/1899 12:00 am\tConqueror X (QubicaAMF)\tTest League\tWeek 1\t18:30\t123\tTest"
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

    // Parse date
    const date = new Date(dateTimeStr.split('  ')[0]);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date format');
    }

    const header = {
      date,
      centerName,
      leagueName,
      weekNumber,
      sessionTime: '18:30', // Default time if not provided
      leagueId,
      description
    };

    console.log('[QubicaParser] Successfully parsed header:', header);
    return header;
  }

  public parse(): QubicaScoreImport {
    console.log('[QubicaParser] Starting to parse score file');
    const header = this.parseHeader();
    console.log('[QubicaParser] Successfully parsed header:', header);

    const games: QubicaTeamGame[] = [];

    // Skip header lines and any separator lines
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
        console.log('[QubicaParser] Found team header at line', this.currentIndex);
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

    return { header, games };
  }
}

export const parseQubicaScoreFile = (fileContent: string): QubicaScoreImport => {
  const parser = new QubicaScoreParser(fileContent);
  return parser.parse();
};