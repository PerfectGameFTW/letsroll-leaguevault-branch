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
import { FormDescription } from "@/components/ui/form";

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
    .min(8, "Password must be at least 8 characters")
    .max(100, "Password must be less than 100 characters")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/,
      "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
    ),
});

type SignUpFormData = z.infer<typeof signUpSchema>;

const SignUpPage: FC = () => {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Initialize form with schema validation
  const form = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      leagueId: "",
      password: "",
    },
  });

  // Fetch leagues for dropdown
  const { data: leagues } = useQuery({
    queryKey: ["/api/leagues"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/leagues");
        if (!response.ok) throw new Error("Failed to fetch leagues");
        const data = await response.json();
        return data.data;
      } catch (error) {
        console.error('[SignUp] Failed to fetch leagues:', error);
        throw error;
      }
    },
  });

  // Handle form submission
  const onSubmit = async (data: SignUpFormData) => {
    try {
      console.log("[SignUp] Submitting registration form:", { email: data.email });

      // Check if email exists
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
      const bowlersResponse = await fetch("/api/bowlers");
      if (!bowlersResponse.ok) {
        throw new Error("Failed to check existing bowlers");
      }
      const bowlersData = await bowlersResponse.json();

      // Look for matching bowler
      const existingBowler = bowlersData.data.find((bowler: any) =>
        bowler.name.toLowerCase() === data.name.toLowerCase() &&
        bowler.email.toLowerCase() === data.email.toLowerCase()
      );

      let signupData = { ...data };
      if (existingBowler) {
        signupData = {
          ...data,
          bowlerId: existingBowler.id,
        };

        toast({
          title: "Existing Bowler Found",
          description: "We've matched your information with an existing bowler profile.",
        });
      }

      // Submit registration
      const response = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(signupData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to sign up. Please try again.");
      }

      const userData = await response.json();
      console.log("[SignUp] Registration successful:", { userId: userData.data.id });

      toast({
        title: "Sign up successful!",
        description: "Welcome to the bowling league management system.",
      });

      // Redirect to home page
      setLocation("/");
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Join Your Bowling League
          </CardTitle>
          <CardDescription className="text-center">
            Sign up to track your scores and manage your league participation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
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
                name="phone"
                render={({ field }) => (
                  <FormItem>
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
                  <FormItem>
                    <FormLabel>League</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a league" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {leagues?.map((league: { id: number; name: string }) => (
                          <SelectItem key={league.id} value={league.id.toString()}>
                            {league.name}
                          </SelectItem>
                        ))}
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
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription className="text-sm text-muted-foreground">
                      Password must contain:
                      <ul className="list-disc list-inside">
                        <li>At least 8 characters</li>
                        <li>One uppercase letter</li>
                        <li>One lowercase letter</li>
                        <li>One number</li>
                        <li>One special character (!@#$%^&*)</li>
                      </ul>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full">
                Create Account
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-center">
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