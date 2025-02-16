import { parseISO, isValid } from 'date-fns';

/**
 * Type for valid ISO date strings
 */
export type ISODateString = string;

/**
 * Type guard to check if a string is a valid ISO date
 */
export function isISODateString(value: string): value is ISODateString {
  try {
    return isValid(parseISO(value));
  } catch {
    return false;
  }
}

/**
 * Function to safely parse ISO date strings
 */
export function parseISODateSafe(date: string): Date | null {
  if (!isISODateString(date)) {
    return null;
  }
  return parseISO(date);
}
