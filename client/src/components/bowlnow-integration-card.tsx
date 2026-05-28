import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
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
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Eye, EyeOff, Pencil } from "lucide-react";
import bowlnowLogo from "@/assets/images/bowlnow-logo.png";

export interface BowlNowConfig {
  enabled: boolean;
  apiKeyConfigured: boolean;
  locationId: string;
  // Task #479: opaque BowlNow custom-field IDs (not secrets). Empty
  // string means "fall back to the platform default for league_name,
  // skip writing for league_season".
  leagueNameFieldId: string;
  leagueSeasonFieldId: string;
}

interface BowlNowCardProps {
  config: BowlNowConfig;
  orgId: number;
}

export function BowlNowCard({ config, orgId }: BowlNowCardProps) {
  const { toast } = useToast();
  const isConfigured = config.apiKeyConfigured && config.enabled;
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState(config.enabled);
  const [apiKey, setApiKey] = useState("");
  const [locationId, setLocationId] = useState(config.locationId);
  const [leagueNameFieldId, setLeagueNameFieldId] = useState(config.leagueNameFieldId);
  const [leagueSeasonFieldId, setLeagueSeasonFieldId] = useState(config.leagueSeasonFieldId);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    setEnabled(config.enabled);
    setLocationId(config.locationId);
    setLeagueNameFieldId(config.leagueNameFieldId);
    setLeagueSeasonFieldId(config.leagueSeasonFieldId);
    setApiKey("");
  }, [
    config.apiKeyConfigured,
    config.enabled,
    config.locationId,
    config.leagueNameFieldId,
    config.leagueSeasonFieldId,
  ]);

  const mutation = useMutation({
    mutationFn: async (data: {
      enabled: boolean;
      apiKey?: string;
      locationId?: string;
      // Sent as the literal string the admin typed (including ""); the
      // PATCH route treats `undefined` as "preserve" and `""` as
      // "clear", so the toggle path (which omits these) won't wipe a
      // previously-saved field ID.
      leagueNameFieldId?: string;
      leagueSeasonFieldId?: string;
    }) => {
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
      // Always send these as strings (including "") so an admin can
      // explicitly clear a saved field ID by emptying the input.
      leagueNameFieldId,
      leagueSeasonFieldId,
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-white flex items-center justify-center overflow-hidden shrink-0">
              <img src={bowlnowLogo} alt="BowlNow" className="w-full h-full object-contain" />
            </div>
            <div>
              <CardTitle className="text-base">BowlNow</CardTitle>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isConfigured ? (
              <Badge className="bg-green-100 text-green-700 border-green-200">
                <CheckCircle2 className="size-3 mr-1" />
                Connected
              </Badge>
            ) : config.apiKeyConfigured ? (
              <Badge variant="secondary">
                <XCircle className="size-3 mr-1" />
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
                <Pencil className="size-3.5 mr-1.5" />
                Edit
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
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
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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

            <Separator />

            <div className="space-y-1">
              <h4 className="text-sm font-medium">Smart List custom field IDs</h4>
              <p className="text-xs text-muted-foreground">
                If you've created custom subscriber fields in BowlNow for League Name and League Season,
                paste their IDs below to keep them in sync. The two fields behave differently when blank
                (see each input's hint). Find each ID in BowlNow under{" "}
                <span className="font-medium">Subscribers &rarr; Custom Fields</span>.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bn-league-name-field-id">
                League Name field ID <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="bn-league-name-field-id"
                placeholder="e.g. cf_league_name_abc123"
                value={leagueNameFieldId}
                onChange={(e) => setLeagueNameFieldId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Overrides the platform default. Leave blank to use the built-in League Name field.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bn-league-season-field-id">
                League Season field ID <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="bn-league-season-field-id"
                placeholder="e.g. cf_league_season_xyz789"
                value={leagueSeasonFieldId}
                onChange={(e) => setLeagueSeasonFieldId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Required for the League Season tag. Without it, season values are not pushed to BowlNow.
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
