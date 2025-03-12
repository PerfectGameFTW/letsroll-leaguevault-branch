import { FC } from "react";
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
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 100;

const signUpSchema = z.object({
  name: z
    .string()
    .min(2, "Full name must be at least 2 characters")
    .max(100, "Full name must be less than 100 characters")
    .regex(/^[a-zA-Z\s'-]+$/, "Full name can only contain letters, spaces, hyphens, and apostrophes"),
  email: z
    .string()
    .email("Please enter a valid email address")
    .max(255, "Email must be less than 255 characters"),
  phone: z
    .string()
    .min(10, "Phone number must be at least 10 digits")
    .max(15, "Phone number must be less than 15 digits")
    .regex(/^[+]?[\d\s-()]+$/, "Please enter a valid phone number"),
  leagueId: z
    .string()
    .min(1, "Please select a league"),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must be less than ${PASSWORD_MAX_LENGTH} characters`)
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[!@#$%^&*]/, "Password must contain at least one special character (!@#$%^&*)")
    .refine(
      (password) => {
        // Additional complexity check - no repetitive characters
        return !/(.)\1{2,}/.test(password);
      },
      "Password cannot contain repetitive characters (e.g., 'aaa')"
    )
    .refine(
      (password) => {
        // Check for common patterns
        const commonPatterns = ['123', 'abc', 'qwerty', 'password'];
        return !commonPatterns.some(pattern => 
          password.toLowerCase().includes(pattern)
        );
      },
      "Password cannot contain common sequences like '123' or 'abc'"
    ),
});

type SignUpFormData = z.infer<typeof signUpSchema>;

const PasswordRequirements: FC<{ errors: Record<string, any> }> = ({ errors }) => {
  const requirements = [
    { text: `At least ${PASSWORD_MIN_LENGTH} characters long`, regex: new RegExp(`.{${PASSWORD_MIN_LENGTH},}`) },
    { text: "One uppercase letter", regex: /[A-Z]/ },
    { text: "One lowercase letter", regex: /[a-z]/ },
    { text: "One number", regex: /[0-9]/ },
    { text: "One special character (!@#$%^&*)", regex: /[!@#$%^&*]/ },
  ];

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Password requirements:</p>
      <ul className="text-sm space-y-1">
        {requirements.map((req, index) => (
          <li
            key={index}
            className={`flex items-center space-x-2 ${
              errors.password ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            <span>•</span>
            <span>{req.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const SignUpPage: FC = () => {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const form = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      leagueId: "",
      password: "",
    },
    mode: "onChange", // Enable real-time validation
  });

  // Define types for API response
  interface League {
    id: number;
    name: string;
    description: string | null;
    active: boolean;
    // Add other fields as needed
  }

  // Using the built-in getQueryFn for fetching
  const { data: leaguesResponse } = useQuery<{success: boolean; data: League[]}>({
    queryKey: ["/api/leagues"],
  });
  
  // Extract leagues data from response safely
  const leagues = leaguesResponse?.data ?? [];

  const onSubmit = async (data: SignUpFormData) => {
    try {
      console.log("[SignUp] Starting registration process:", { 
        email: data.email,
        name: data.name,
        leagueId: data.leagueId 
      });

      const existingUsersResponse = await fetch(`/api/users/check-email/${encodeURIComponent(data.email)}`);
      if (!existingUsersResponse.ok) {
        throw new Error("Failed to verify email availability");
      }
      const existingUserData = await existingUsersResponse.json();

      if (existingUserData.exists) {
        toast({
          title: "Account Already Exists",
          description: "An account with this email already exists. Please sign in instead.",
          variant: "destructive",
        });
        return;
      }

      // Check for existing bowler
      console.log("[SignUp] Checking for existing bowler profile");
      const bowlersResponse = await fetch("/api/bowlers");
      if (!bowlersResponse.ok) {
        throw new Error("Failed to check existing bowlers");
      }
      const bowlersData = await bowlersResponse.json();

      const existingBowler = bowlersData.data.find((bowler: any) =>
        bowler.name.toLowerCase() === data.name.toLowerCase() &&
        bowler.email.toLowerCase() === data.email.toLowerCase()
      );

      if (existingBowler) {
        console.log("[SignUp] Found existing bowler:", existingBowler);
        toast({
          title: "Existing Bowler Found",
          description: "We've matched your information with an existing bowler profile.",
          variant: "default",
        });
      }

      console.log("[SignUp] Submitting registration data");
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "Failed to sign up. Please try again.");
      }

      const userData = await response.json();
      console.log("[SignUp] Registration successful:", { 
        userId: userData.data.id,
        bowlerId: userData.data.bowlerId,
        success: userData.success 
      });

      // Verify the user data includes the bowler ID
      if (!userData.data.bowlerId) {
        console.error("[SignUp] Warning: Registered user does not have a bowler ID");
        toast({
          title: "Partial Registration Success",
          description: "Your account was created but some profile information may be incomplete. Please contact support.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Sign up successful!",
          description: "Welcome to the bowling league management system.",
          variant: "default",
        });
      }

      setLocation("/bowler-dashboard");
    } catch (error) {
      console.error('[SignUp] Registration error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to sign up. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-start sm:items-center justify-center p-4 pt-6 sm:pt-4">
      <Card className="w-full max-w-md mt-4 sm:mt-0">
        <CardHeader className="space-y-1 pb-4 sm:pb-6">
          <CardTitle className="text-2xl font-bold text-center">
            Join Your Bowling League
          </CardTitle>
          <CardDescription className="text-center">
            Sign up to track your scores and manage your league participation
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-4 sm:pb-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 sm:space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
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
                name="phone"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="(555) 123-4567"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="leagueId"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
                    <FormLabel>League</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a league" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Array.isArray(leagues) ? leagues.map((league: { id: number; name: string }) => (
                          <SelectItem key={league.id} value={league.id.toString()}>
                            {league.name}
                          </SelectItem>
                        )) : null}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="space-y-1 sm:space-y-2">
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        {...field}
                      />
                    </FormControl>
                    <PasswordRequirements errors={form.formState.errors} />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full mt-2">
                Create Account
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-center pt-0">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
};

export default SignUpPage;