export function getSeasonLabel(seasonStart: Date | string, seasonEnd: Date | string): string {
  const start = new Date(seasonStart);
  const end = new Date(seasonEnd);
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  if (startYear !== endYear) {
    const startYY = String(startYear).slice(-2);
    const endYY = String(endYear).slice(-2);
    return `${startYY}/${endYY} Season`;
  }

  const month = start.getMonth();
  const yearSuffix = `'${String(startYear).slice(-2)}`;
  if (month === 11 || month === 0 || month === 1) {
    return `Winter ${yearSuffix} Season`;
  } else if (month >= 2 && month <= 4) {
    return `Spring ${yearSuffix} Season`;
  } else if (month >= 5 && month <= 7) {
    return `Summer ${yearSuffix} Season`;
  } else {
    return `Fall ${yearSuffix} Season`;
  }
}
