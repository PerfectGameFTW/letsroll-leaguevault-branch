import type { QubicaScoreImport } from '@shared/schema';
import { QubicaParser, parseQubicaScoreFile } from '../qubica-parser';

describe('QubicaParser', () => {
  const sampleTeamHeader = '014\t1\t0\t2\t14\t*\t*\t0\t9\tSlow Rollers';
  const sampleBowlerScores = [
    '014\t1\t1\t3\t234\tS\tS\t118\t9\tMelanie Burke',
    '014\t2\t1\t8\t234\tS\tS\t119\t9\tMelanie Burke',
    '014\t3\t1\t13\t234\tS\tS\t117\t9\tMelanie Burke'
  ];

  describe('Line Parsing', () => {
    const parser = new QubicaParser('');

    it('correctly parses bowler score lines', () => {
      const score = (parser as any).parseBowlerScore(sampleBowlerScores[0]);
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

      expect(result.games).toHaveLength(3);

      const gameNumbers = result.games.map(g => g.gameNumber).sort();
      expect(gameNumbers).toEqual([1, 2, 3]);

      const scores = result.games.map(g => g.bowlers[0].score);
      expect(scores).toEqual([118, 119, 117]);
    });
  });
});