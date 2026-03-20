import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";
import { SiSquare } from "react-icons/si";
import type { ApiResponse } from "@shared/schema";

interface IntegrationsConfig {
  bowlnow: {
    enabled: boolean;
    apiKeyConfigured: boolean;
    locationId: string;
  };
}

interface BowlNowCardProps {
  config: IntegrationsConfig["bowlnow"];
}

function BowlNowCard({ config }: BowlNowCardProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState(config.enabled);
  const [apiKey, setApiKey] = useState("");
  const [locationId, setLocationId] = useState(config.locationId);
  const [showApiKey, setShowApiKey] = useState(false);

  const mutation = useMutation({
    mutationFn: async (data: { enabled: boolean; apiKey?: string; locationId?: string }) => {
      return apiRequest("/api/integrations", "PATCH", { bowlnow: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bn/status"] });
      toast({ title: "BowlNow settings saved", description: "Your integration settings have been updated." });
      setApiKey("");
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

  const isConfigured = config.apiKeyConfigured && config.enabled;

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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              BowlNow (powered by GoHighLevel) keeps your bowler contact list up to date automatically.
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
                Find your API key in your BowlNow account under Settings → API.
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

function SquareCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-black flex items-center justify-center">
              <SiSquare className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base">Square</CardTitle>
              <CardDescription>Payment processing and customer management</CardDescription>
            </div>
          </div>
          <Badge className="bg-green-100 text-green-700 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            System Configured
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Square is configured at the system level and powers payment processing for all leagues.
          Bowlers are automatically registered as Square customers when added, enabling saved-card auto-pay.
          Contact your system administrator to update Square credentials.
        </p>
      </CardContent>
    </Card>
  );
}

export default function IntegrationsPage() {
  const { data: integrationsResponse, isLoading } = useQuery<ApiResponse<IntegrationsConfig>>({
    queryKey: ["/api/integrations"],
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const config = integrationsResponse?.data;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-muted-foreground mt-1">
          Connect third-party services to enhance your league management experience.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
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
      ) : (
        <div className="space-y-4 max-w-2xl">
          {config && <BowlNowCard config={config.bowlnow} />}
          <SquareCard />
        </div>
      )}
    </Layout>
  );
}
