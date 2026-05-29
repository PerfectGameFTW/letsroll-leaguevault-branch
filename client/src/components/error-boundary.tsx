import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  level?: "page" | "section" | "inline";
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("ErrorBoundary", `Caught error (component stack: ${errorInfo.componentStack ?? "n/a"})`, error);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const level = this.props.level ?? "section";

      if (level === "inline") {
        return (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            <span>Something went wrong</span>
            <Button variant="ghost" size="sm" onClick={this.handleReset} className="ml-auto h-7 px-2">
              <RefreshCw className="size-3" />
            </Button>
          </div>
        );
      }

      if (level === "page") {
        return (
          <div className="flex min-h-[60vh] items-center justify-center p-8">
            <Card className="max-w-md w-full">
              <CardHeader className="text-center">
                <AlertTriangle className="size-10 text-destructive mx-auto mb-2" />
                <CardTitle>Something went wrong</CardTitle>
              </CardHeader>
              <CardContent className="text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                  An unexpected error occurred while loading this page. Please try refreshing.
                </p>
                {this.state.error && (
                  <p className="text-xs text-muted-foreground font-mono bg-muted rounded p-2 break-all">
                    {this.state.error.message}
                  </p>
                )}
                <div className="flex gap-2 justify-center">
                  <Button onClick={this.handleReset}>
                    <RefreshCw className="mr-2 size-4" />
                    Try Again
                  </Button>
                  <Button variant="outline" onClick={() => window.location.reload()}>
                    Refresh Page
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }

      return (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="size-5 text-destructive shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">This section encountered an error</p>
              {this.state.error && (
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {this.state.error.message}
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={this.handleReset}>
              <RefreshCw className="mr-1 size-3" />
              Retry
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
