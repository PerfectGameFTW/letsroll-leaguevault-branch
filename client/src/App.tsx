import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home-page";
import LeaguesPage from "@/pages/leagues-page";
import BowlersPage from "@/pages/bowlers-page";
import PaymentsPage from "@/pages/payments-page";
import { useEffect } from "react";
import { initializeSquare } from "./lib/square";
import { useToast } from "@/hooks/use-toast";

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/leagues" component={LeaguesPage} />
      <Route path="/bowlers" component={BowlersPage} />
      <Route path="/payments" component={PaymentsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const { toast } = useToast();

  useEffect(() => {
    initializeSquare().catch((error) => {
      toast({
        title: "Square Integration Error",
        description: error.message,
        variant: "destructive",
      });
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;