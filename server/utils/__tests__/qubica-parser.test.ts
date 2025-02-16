import { QubicaScoreParser } from '../qubica-parser';

describe('QubicaParser', () => {
  const sampleHeader = '* 12/30/1899 12:00 am\tConqueror X (QubicaAMF)\tFarmington Mixed 24/25\tWeek 20\t18:30\t365879\tMichael Shearer, Perfect Game';
  const sampleTeamData = [
    '014\t1\t0\t2\t14\t*\t*\t0\t9\tSlow Rollers',
    '014\t1\t1\t3\t234\tS\tS\t118\t9\tMelanie Burke',
    '014\t2\t1\t8\t234\tS\tS\t119\t9\tMelanie Burke',
    '014\t3\t1\t13\t234\tS\tS\t117\t9\tMelanie Burke'
  ].join('\n');

  describe('Header Parsing', () => {
    it('correctly parses league information from header', () => {
      const parser = new QubicaScoreParser(sampleHeader);
      const result = parser.parse();

      expect(result.header.leagueName).toBe('Farmington Mixed 24/25');
      expect(result.header.weekNumber).toBe(20);
      expect(result.header.sessionTime).toBe('18:30');
      expect(result.header.leagueId).toBe('365879');
      expect(result.header.description).toBe('Michael Shearer, Perfect Game');
    });

    it('handles malformed headers gracefully', () => {
      const badHeader = '* Invalid Header';
      const parser = new QubicaScoreParser(badHeader);
      const result = parser.parse();

      expect(result.header.leagueName).toBe('Unknown League');
      expect(result.header.weekNumber).toBe(1);
    });
  });

  describe('Score Parsing', () => {
    const fullData = `${sampleHeader}\n${sampleTeamData}`;

    it('correctly parses bowler scores', () => {
      const parser = new QubicaScoreParser(fullData);
      const result = parser.parse();

      expect(result.games).toHaveLength(3); // Three games for the team

      // Check first game details
      const firstGame = result.games[0];
      expect(firstGame.teamNumber).toBe('014');
      expect(firstGame.gameNumber).toBe(1);
      expect(firstGame.laneNumber).toBe(9);
      expect(firstGame.bowlers).toHaveLength(1);

      // Check bowler details
      const bowler = firstGame.bowlers[0];
      expect(bowler.bowlerName).toBe('Melanie Burke');
      expect(bowler.score).toBe(118);
      expect(bowler.status.isSub).toBe(true);
    });

    it('correctly handles status flags', () => {
      const dataWithFlags = `${sampleHeader}\n014\t1\t1\t3\t234\tA\tA\t0\t9\tVACANT`;
      const parser = new QubicaScoreParser(dataWithFlags);
      const result = parser.parse();

      const bowler = result.games[0].bowlers[0];
      expect(bowler.status.isVacant).toBe(true);
      expect(bowler.status.isAbsent).toBe(true);
      expect(bowler.status.isSub).toBe(false);
    });
  });

  describe('Team Organization', () => {
    const fullData = `${sampleHeader}\n${sampleTeamData}`;

    it('correctly groups games by team', () => {
      const parser = new QubicaScoreParser(fullData);
      const result = parser.parse();

      // Check that games are sorted by lane and game number
      expect(result.games.map(g => g.gameNumber)).toEqual([1, 2, 3]);

      // Verify all games have the same lane number for the team
      const laneNumbers = new Set(result.games.map(g => g.laneNumber));
      expect(laneNumbers.size).toBe(1);
      expect(laneNumbers.has(9)).toBe(true);
    });
  });
});