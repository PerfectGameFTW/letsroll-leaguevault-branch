import { QubicaScoreParser } from '../qubica-parser';

describe('QubicaParser Date Parsing', () => {
  const sampleHeader = '* 12/30/1899 12:00 amConqueror X (QubicaAMF)Farmington Mixed 24/25Week 20February 3, 2025  18:30365879Michael Shearer, Perfect Game';

  it('correctly parses the date from header line', () => {
    const parser = new QubicaScoreParser(sampleHeader);
    const result = parser.parse();

    // Expected date is February 3, 2025 18:30 UTC
    const expectedDate = new Date(Date.UTC(2025, 1, 3, 18, 30));

    expect(result.header.date).toBeDefined();
    expect(result.header.date.getTime()).toBe(expectedDate.getTime());
    expect(result.header.date.toISOString()).toBe('2025-02-03T18:30:00.000Z');

    // Verify individual components
    expect(result.header.date.getUTCFullYear()).toBe(2025);
    expect(result.header.date.getUTCMonth()).toBe(1); // February is 1
    expect(result.header.date.getUTCDate()).toBe(3);
    expect(result.header.date.getUTCHours()).toBe(18);
    expect(result.header.date.getUTCMinutes()).toBe(30);
    expect(result.header.date.getUTCSeconds()).toBe(0);
  });

  it('throws error for invalid date format', () => {
    const invalidHeader = '* InvalidDateFormatConqueror X (QubicaAMF)Farmington Mixed 24/25Week 20';
    const parser = new QubicaScoreParser(invalidHeader);

    expect(() => parser.parse()).toThrow('Could not find date pattern in header');
  });
});