// This file is deprecated. The main App component is now in client/src/App.tsx
// This file will be removed in a future update.
import { useLocation } from "wouter";

export default function DeprecatedApp() {
  const [, setLocation] = useLocation();

  // Redirect to the home page
  setLocation("/");
  return null;
}