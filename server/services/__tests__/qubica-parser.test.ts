import type { QubicaScoreImport } from '@shared/schema';
import { QubicaScoreParser, parseQubicaScoreFile } from '../../utils/qubica-parser.js';

describe('QubicaScoreParser', () => {
  const sampleTeamHeader = '014\t1\t0\t2\t14\t*\t*\t0\t9\tSlow Rollers';
  const sampleBowlerScores = [
    '014\t1\t1\t3\t234\tS\tS\t118\t9\tMelanie Burke',
    '014\t2\t1\t8\t234\tS\tS\t119\t9\tMelanie Burke',
    '014\t3\t1\t13\t234\tS\tS\t117\t9\tMelanie Burke'
  ];

  describe('Team Header Detection', () => {
    const parser = new QubicaScoreParser('');

    it('correctly identifies team headers', () => {
      // Private method access for testing
      const isTeamHeaderLine = (parser as any).isTeamHeaderLine.bind(parser);

      expect(isTeamHeaderLine(sampleTeamHeader)).toBe(true);
      expect(isTeamHeaderLine(sampleBowlerScores[0])).toBe(false);
    });
  });

  describe('Game Number Parsing', () => {
    const parser = new QubicaScoreParser('');

    it('correctly parses game numbers from lines', () => {
      // Private method access for testing
      const parseLine = (parser as any).parseLine.bind(parser);

      const [teamNumber1, gameNumber1] = parseLine(sampleBowlerScores[0]) || [];
      expect(gameNumber1).toBe(1);

      const [teamNumber2, gameNumber2] = parseLine(sampleBowlerScores[1]) || [];
      expect(gameNumber2).toBe(2);

      const [teamNumber3, gameNumber3] = parseLine(sampleBowlerScores[2]) || [];
      expect(gameNumber3).toBe(3);
    });
  });

  describe('Score Line Parsing', () => {
    const parser = new QubicaScoreParser('');

    it('correctly parses bowler score lines', () => {
      // Private method access for testing
      const parseBowlerScore = (parser as any).parseBowlerScore.bind(parser);

      const score = parseBowlerScore(sampleBowlerScores[0]);
      expect(score).toMatchObject({
        teamNumber: '014',
        gameNumber: 1,
        position: 1,
        bowlerId: '234',
        bowlerName: 'Melanie Burke',
        score: 118,
        status: {
          isVacant: false,
          isAbsent: false,
          isSub: true
        }
      });
    });
  });

  describe('Multiple Games Per Team', () => {
    const sampleTeamData = `
* 12/30/1899 12:00 am\tConqueror X (QubicaAMF)\tTest League\tWeek 1\t18:30\t123\tTest
**-------------------------------------------------------------------------------
014\t1\t0\t2\t14\t*\t*\t0\t9\tSlow Rollers
014\t1\t1\t3\t234\tS\tS\t118\t9\tMelanie Burke
014\t2\t1\t8\t234\tS\tS\t119\t9\tMelanie Burke
014\t3\t1\t13\t234\tS\tS\t117\t9\tMelanie Burke`;

    it('correctly groups multiple games for each team', () => {
      const result = parseQubicaScoreFile(sampleTeamData);

      // Verify games are parsed correctly
      expect(result.games).toHaveLength(3);

      // Check game numbers
      const gameNumbers = result.games.map(g => g.gameNumber).sort();
      expect(gameNumbers).toEqual([1, 2, 3]);

      // Verify each game has the correct score
      const scores = result.games.map(g => g.bowlers[0].score);
      expect(scores).toEqual([118, 119, 117]);
    });
  });
});