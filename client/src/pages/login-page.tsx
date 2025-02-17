import { FC, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { Loader2 } from "@/components/ui/loader";

const loginSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid email address"),
  password: z
    .string()
    .min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

const LoginPage: FC = () => {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      setIsLoading(true);
      console.log("[Login] Attempting login with email:", data.email, {
        isMobile: window.innerWidth <= 768,
        timestamp: new Date().toISOString()
      });

      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", 
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("[Login] Server error response:", {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
          isMobile: window.innerWidth <= 768,
          url: response.url,
          cookiesPresent: document.cookie.length > 0,
          timestamp: new Date().toISOString()
        });
        throw new Error(errorData.error?.message || "Invalid email or password");
      }

      const userData = await response.json();
      console.log("[Login] Login successful:", {
        userId: userData.data.id,
        bowlerId: userData.data.bowlerId,
        sessionPresent: document.cookie.includes('bowlingleague.sid'),
        isMobile: window.innerWidth <= 768,
        cookiesEnabled: navigator.cookieEnabled,
        timestamp: new Date().toISOString()
      });

      const verifySession = async () => {
        try {
          const verifyResponse = await fetch("/api/user", {
            credentials: "include"
          });
          return verifyResponse.ok;
        } catch (error) {
          console.error("[Login] Session verification failed:", error);
          return false;
        }
      };

      const delay = window.innerWidth <= 768 ? 2000 : 500;
      console.log(`[Login] Waiting ${delay}ms before session verification`);

      await new Promise(resolve => setTimeout(resolve, delay));

      const isSessionValid = await verifySession();

      if (!isSessionValid) {
        console.error("[Login] Session validation failed after delay");
        throw new Error("Failed to establish secure session. Please try again.");
      }

      toast({
        title: "Login successful!",
        description: "Welcome back to the bowling league management system.",
      });

      setLocation("/bowler-dashboard");
    } catch (error) {
      console.error("[Login] Login error:", error);
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Failed to login. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Welcome Back
          </CardTitle>
          <CardDescription className="text-center">
            Sign in to your bowling league account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="john@example.com"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link href="/sign-up" className="text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
};

export default LoginPage;