declare module 'express-session' {
  interface SessionData {
    currentChallenge?: string;
    authEmail?: string;
  }
}
