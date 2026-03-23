import { FC, useMemo } from "react";
import { queryClient } from "@/lib/queryClient";
import { ErrorBoundary } from "@/components/error-boundary";
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
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getSubdomainSlug } from "@/lib/subdomain";

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
        return !/(.)\1{2,}/.test(password);
      },
      "Password cannot contain repetitive characters (e.g., 'aaa')"
    )
    .refine(
      (password) => {
        const commonPatterns = ['123', 'abc', 'qwerty', 'password'];
        return !commonPatterns.some(pattern => 
          password.toLowerCase().includes(pattern)
        );
      },
      "Password cannot contain common sequences like '123' or 'abc'"
    ),
});

type SignUpFormData = z.infer<typeof signUpSchema>;

interface OrgInfo {
  id: number;
  name: string;
  slug: string;
  logo: string | null;
}

interface League {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
}

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
  const searchString = useSearch();

  const orgSlug = useMemo(() => {
    const subdomainSlug = getSubdomainSlug();
    if (subdomainSlug) return subdomainSlug;
    const params = new URLSearchParams(searchString);
    return params.get("org") || null;
  }, [searchString]);

  const form = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      leagueId: "",
      password: "",
    },
    mode: "onChange",
  });

  const { data: orgResponse } = useQuery<{ success: boolean; data: OrgInfo }>({
    queryKey: ["/api/organizations/slug", orgSlug],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/slug/${orgSlug}`);
      if (!res.ok) throw new Error("Organization not found");
      return res.json();
    },
    enabled: !!orgSlug,
  });

  const orgInfo = orgResponse?.data ?? null;

  const { data: orgLeaguesResponse } = useQuery<{ success: boolean; data: League[] }>({
    queryKey: ["/api/organizations/slug", orgSlug, "leagues"],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/slug/${orgSlug}/leagues`);
      if (!res.ok) throw new Error("Failed to fetch leagues");
      return res.json();
    },
    enabled: !!orgSlug,
  });

  const { data: allLeaguesResponse } = useQuery<{ success: boolean; data: League[] }>({
    queryKey: ["/api/leagues"],
    enabled: !orgSlug,
  });

  const leagues = orgSlug
    ? (orgLeaguesResponse?.data ?? [])
    : (allLeaguesResponse?.data ?? []);

  const onSubmit = async (data: SignUpFormData) => {
    try {
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
        toast({
          title: "Existing Bowler Found",
          description: "We've matched your information with an existing bowler profile.",
          variant: "default",
        });
      }

      const registerBody: any = { ...data };
      if (orgInfo?.id) {
        registerBody.organizationId = orgInfo.id;
      }

      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(registerBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "Failed to sign up. Please try again.");
      }

      const userData = await response.json();

      queryClient.setQueryData(['/api/user'], userData);

      if (!userData.data.bowlerId) {
        toast({
          title: "Account Created",
          description: "Let's link your account to your bowler profile.",
          variant: "default",
        });
      } else {
        toast({
          title: "Sign up successful!",
          description: "Welcome to the bowling league management system.",
          variant: "default",
        });
      }

      if (userData.data.bowlerId) {
        setLocation("/bowler-dashboard");
      } else {
        const claimUrl = orgInfo?.id
          ? `/claim-bowler?organizationId=${orgInfo.id}`
          : "/claim-bowler";
        setLocation(claimUrl);
      }
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
    <ErrorBoundary level="section">
    <div className="min-h-screen bg-background flex items-start sm:items-center justify-center p-4 pt-6 sm:pt-4">
      <Card className="w-full max-w-md mt-4 sm:mt-0">
        <CardHeader className="space-y-1 pb-4 sm:pb-6">
          {orgInfo?.logo && (
            <div className="flex justify-center mb-2">
              <img
                src={orgInfo.logo}
                alt={orgInfo.name}
                className="h-16 w-auto object-contain"
              />
            </div>
          )}
          <CardTitle className="text-2xl font-bold text-center">
            {orgInfo ? `Welcome to ${orgInfo.name}` : "Join Your Bowling League"}
          </CardTitle>
          <CardDescription className="text-center">
            Sign up to manage your weekly league payments
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
    </ErrorBoundary>
  );
};

export default SignUpPage;
