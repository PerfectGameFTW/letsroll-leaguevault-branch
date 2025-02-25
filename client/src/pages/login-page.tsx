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
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

const LoginPage: FC = () => {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [biometricEmail, setBiometricEmail] = useState("");

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const handleBiometricAuth = async (email: string) => {
    try {
      setIsLoading(true);

      // Get authentication options
      const optionsRes = await fetch("/api/webauthn/authenticate/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!optionsRes.ok) {
        const error = await optionsRes.json();
        throw new Error(error.error?.message || "Failed to start biometric authentication");
      }

      const options = await optionsRes.json();

      // Start the authentication process
      const authResponse = await startAuthentication(options.data);

      // Verify the authentication
      const verificationRes = await fetch("/api/webauthn/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authResponse),
      });

      if (!verificationRes.ok) {
        const error = await verificationRes.json();
        throw new Error(error.error?.message || "Failed to verify biometric authentication");
      }

      const verification = await verificationRes.json();

      toast({
        title: "Login successful!",
        description: "Welcome back to the bowling league management system.",
      });

      setLocation("/bowler-dashboard");
    } catch (error) {
      console.error("[Login] Biometric auth error:", error);
      toast({
        title: "Biometric authentication failed",
        description: error instanceof Error ? error.message : "Failed to authenticate. Please try again or use password.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = async (data: LoginFormData) => {
    try {
      setIsLoading(true);
      console.log("[Login] Attempting login with email:", data.email);

      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "Invalid email or password");
      }

      const userData = await response.json();
      console.log("[Login] Login successful:", {
        userId: userData.data.id,
        bowlerId: userData.data.bowlerId,
      });

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
        <CardContent className="space-y-4">
          {/* Biometric Authentication Section */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="Enter email for biometric login"
                value={biometricEmail}
                onChange={(e) => setBiometricEmail(e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!biometricEmail || isLoading}
                onClick={() => handleBiometricAuth(biometricEmail)}
              >
                <Fingerprint className="h-4 w-4 mr-2" />
                Face ID
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with password
              </span>
            </div>
          </div>

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
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isLoading}>
                Sign In
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