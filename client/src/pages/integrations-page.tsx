import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Eye, EyeOff, Pencil, AlertCircle } from "lucide-react";
import { SiSquare } from "react-icons/si";
import type { ApiResponse, Organization, Location, User } from "@shared/schema";

interface IntegrationsConfig {
  bowlnow: {
    enabled: boolean;
    apiKeyConfigured: boolean;
    locationId: string;
  };
}

interface SquareLocationConfig {
  appId: string | null;
  accessTokenConfigured: boolean;
  locationId: string | null;
}

interface BowlNowCardProps {
  config: IntegrationsConfig["bowlnow"];
  orgId: number;
}

function BowlNowCard({ config, orgId }: BowlNowCardProps) {
  const { toast } = useToast();
  const isConfigured = config.apiKeyConfigured && config.enabled;
  const [expanded, setExpanded] = useState(!isConfigured);
  const [enabled, setEnabled] = useState(config.enabled);
  const [apiKey, setApiKey] = useState("");
  const [locationId, setLocationId] = useState(config.locationId);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    const configured = config.apiKeyConfigured && config.enabled;
    setExpanded(!configured);
    setEnabled(config.enabled);
    setLocationId(config.locationId);
    setApiKey("");
  }, [config.apiKeyConfigured, config.enabled, config.locationId]);

  const mutation = useMutation({
    mutationFn: async (data: { enabled: boolean; apiKey?: string; locationId?: string }) => {
      return apiRequest("/api/integrations", "PATCH", { organizationId: orgId, bowlnow: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations", orgId] });
      queryClient.invalidateQueries({ queryKey: ["/api/bn/status"] });
      toast({ title: "BowlNow settings saved", description: "Your integration settings have been updated." });
      setApiKey("");
      setExpanded(false);
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  function handleToggleEnabled(checked: boolean) {
    setEnabled(checked);
    if (!checked) {
      mutation.mutate({ enabled: false });
    } else if (config.apiKeyConfigured) {
      mutation.mutate({ enabled: true });
    } else {
      setExpanded(true);
    }
  }

  function handleSave() {
    mutation.mutate({
      enabled,
      apiKey: apiKey || undefined,
      locationId: locationId || undefined,
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
              <span className="text-orange-600 font-bold text-sm">BN</span>
            </div>
            <div>
              <CardTitle className="text-base">BowlNow</CardTitle>
              <CardDescription>Sync bowler contacts with your BowlNow CRM</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isConfigured ? (
              <Badge className="bg-green-100 text-green-700 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Connected
              </Badge>
            ) : config.apiKeyConfigured ? (
              <Badge variant="secondary">
                <XCircle className="h-3 w-3 mr-1" />
                Disabled
              </Badge>
            ) : (
              <Badge variant="outline">Not configured</Badge>
            )}
            <Switch
              checked={enabled}
              onCheckedChange={handleToggleEnabled}
              disabled={mutation.isPending}
            />
            {isConfigured && !expanded ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExpanded(true)}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              BowlNow keeps your bowler contact list up to date automatically.
              When a bowler is added or updated, their name, email, phone, league, and team are synced to your BowlNow account.
            </p>

            <div className="space-y-2">
              <Label htmlFor="bn-api-key">API Key</Label>
              <div className="relative">
                <Input
                  id="bn-api-key"
                  type={showApiKey ? "text" : "password"}
                  placeholder={config.apiKeyConfigured ? "••••••••••••••• (configured — enter new key to replace)" : "Paste your BowlNow API key"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Find your API key in your BowlNow account under Settings &rarr; API.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bn-location-id">Location ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="bn-location-id"
                placeholder="Your BowlNow Location ID"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Your BowlNow Location ID links this integration to the correct account. Leave blank to use the system default.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setExpanded(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}

interface SquareLocationCardProps {
  location: Location;
}

function SquareLocationCard({ location }: SquareLocationCardProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [appId, setAppId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [squareLocationId, setSquareLocationId] = useState("");
  const [showToken, setShowToken] = useState(false);

  const { data: configResponse, isLoading } = useQuery<ApiResponse<SquareLocationConfig>>({
    queryKey: ["/api/locations", location.id, "square-config"],
    queryFn: async () => {
      const res = await fetch(`/api/locations/${location.id}/square-config`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const config = configResponse?.data;
  const isConfigured = !!(config?.accessTokenConfigured);

  const mutation = useMutation({
    mutationFn: async (data: { appId?: string; accessToken?: string; locationId?: string }) => {
      return apiRequest(`/api/locations/${location.id}/square-config`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", location.id, "square-config"] });
      toast({ title: "Square settings saved", description: `Square credentials for ${location.name} have been updated.` });
      setAccessToken("");
      setExpanded(false);
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  function handleOpen() {
    if (config) {
      setAppId(config.appId || "");
      setSquareLocationId(config.locationId || "");
    }
    setAccessToken("");
    setExpanded(true);
  }

  function handleSave() {
    mutation.mutate({
      appId: appId || undefined,
      accessToken: accessToken || undefined,
      locationId: squareLocationId || undefined,
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center shrink-0">
              <SiSquare className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">{location.name}</CardTitle>
              <CardDescription>Square payment processing for this location</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isLoading ? (
              <div className="h-5 w-24 bg-muted animate-pulse rounded-full" />
            ) : isConfigured ? (
              <Badge className="bg-green-100 text-green-700 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Configured
              </Badge>
            ) : (
              <Badge variant="outline">Not configured</Badge>
            )}
            {isConfigured && !expanded ? (
              <Button variant="outline" size="sm" onClick={handleOpen}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            ) : !expanded ? (
              <Button variant="outline" size="sm" onClick={handleOpen}>
                Configure
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
                <ChevronUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the Square credentials for <strong>{location.name}</strong>. Each location uses its own Square account for payment processing.
            </p>

            <div className="space-y-2">
              <Label htmlFor={`sq-app-id-${location.id}`}>Application ID</Label>
              <Input
                id={`sq-app-id-${location.id}`}
                placeholder={config?.appId ? config.appId : "sq0idp-..."}
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Found in your Square Developer Dashboard under your application.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`sq-token-${location.id}`}>Access Token</Label>
              <div className="relative">
                <Input
                  id={`sq-token-${location.id}`}
                  type={showToken ? "text" : "password"}
                  placeholder={config?.accessTokenConfigured ? "••••••••••••••• (configured — enter new token to replace)" : "EAAAEv..."}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Production access token from your Square Developer Dashboard.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`sq-loc-${location.id}`}>Square Location ID</Label>
              <Input
                id={`sq-loc-${location.id}`}
                placeholder={config?.locationId ? config.locationId : "L..."}
                value={squareLocationId}
                onChange={(e) => setSquareLocationId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Found in your Square Dashboard under Account &amp; Settings &rarr; Locations.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setExpanded(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save Credentials"}
              </Button>
            </div>
          </CardContent>
        </>
      )}
    </Card>
  );
}

interface SquareSectionProps {
  orgId: number;
}

function SquareSection({ orgId }: SquareSectionProps) {
  const { data: locationsResponse, isLoading } = useQuery<ApiResponse<Location[]>>({
    queryKey: ["/api/locations", { organizationId: orgId }],
    queryFn: async () => {
      const res = await fetch(`/api/locations?organizationId=${orgId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch locations: ${res.status}`);
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const locations = (locationsResponse?.data ?? []).filter((l) => l.active);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center shrink-0">
          <SiSquare className="h-5 w-5 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Square</h3>
          <p className="text-xs text-muted-foreground">Payment processing — configured per location</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
                  <div className="space-y-2">
                    <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-48 bg-muted animate-pulse rounded" />
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : locations.length === 0 ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              No active locations found for this organization. Add a location first to configure Square credentials.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {locations.map((location) => (
            <SquareLocationCard key={location.id} location={location} />
          ))}
        </div>
      )}
    </div>
  );
}

interface IntegrationsContentProps {
  orgId: number;
}

function IntegrationsContent({ orgId }: IntegrationsContentProps) {
  const { data: integrationsResponse, isLoading, isError } = useQuery<ApiResponse<IntegrationsConfig>>({
    queryKey: ["/api/integrations", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/integrations?organizationId=${orgId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch integrations: ${res.status}`);
      return res.json();
    },
    staleTime: 0,
    retry: false,
  });

  const config = integrationsResponse?.data;

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-2xl">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
                <div className="space-y-2">
                  <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                  <div className="h-3 w-48 bg-muted animate-pulse rounded" />
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-2xl">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium text-sm">Failed to load integrations</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  There was a problem loading the integration settings for this organization. Please try refreshing the page.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {config && <BowlNowCard config={config.bowlnow} orgId={orgId} />}
      <SquareSection orgId={orgId} />
    </div>
  );
}

export default function IntegrationsPage() {
  const { data: currentUserResponse } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5,
  });

  const currentUser = currentUserResponse?.data;
  const isSystemAdmin = currentUser?.role === "system_admin";

  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);

  const effectiveOrgId = isSystemAdmin
    ? (selectedOrgId ?? currentUser?.organizationId ?? null)
    : (currentUser?.organizationId ?? null);

  const { data: orgsResponse } = useQuery<ApiResponse<Organization[]>>({
    queryKey: ["/api/organizations"],
    enabled: isSystemAdmin,
    staleTime: 1000 * 60 * 5,
  });

  const orgList = orgsResponse?.data ?? [];

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-muted-foreground mt-1">
          Connect third-party services to enhance your league management experience.
        </p>
      </div>

      {isSystemAdmin && orgList.length > 0 && (
        <div className="mb-6 max-w-2xl">
          <Label htmlFor="org-select" className="text-sm font-medium mb-2 block">
            Organization
          </Label>
          <Select
            value={effectiveOrgId ? String(effectiveOrgId) : ""}
            onValueChange={(val) => {
              setSelectedOrgId(Number(val));
            }}
          >
            <SelectTrigger id="org-select" className="w-64">
              <SelectValue placeholder="Select an organization..." />
            </SelectTrigger>
            <SelectContent>
              {orgList.map((org) => (
                <SelectItem key={org.id} value={String(org.id)}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!effectiveOrgId ? (
        <div className="text-muted-foreground text-sm">
          {isSystemAdmin ? "Select an organization above to manage its integrations." : "No organization context found."}
        </div>
      ) : (
        <IntegrationsContent key={effectiveOrgId} orgId={effectiveOrgId} />
      )}
    </Layout>
  );
}
