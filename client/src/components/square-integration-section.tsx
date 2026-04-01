import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { ChevronUp, CheckCircle2, Eye, EyeOff, Pencil, CreditCard } from "lucide-react";
import { SiSquare } from "react-icons/si";
import type { ApiResponse, Location, PaymentProviderType } from "@shared/schema";
import { clearProviderConfigCache } from "@/hooks/use-payment-provider";

interface SquareLocationConfig {
  appId: string | null;
  accessTokenConfigured: boolean;
  locationId: string | null;
}

interface CardPointeLocationConfig {
  merchantId: string | null;
  apiUsernameConfigured: boolean;
  apiPasswordConfigured: boolean;
  siteUrl: string | null;
}

interface PaymentLocationCardProps {
  location: Location;
}

function ProviderSelector({ location }: { location: Location }) {
  const { toast } = useToast();
  const currentProvider = (location.paymentProvider as PaymentProviderType) || 'square';

  const mutation = useMutation({
    mutationFn: async (provider: PaymentProviderType) => {
      return apiRequest(`/api/locations/${location.id}/payment-provider`, "PATCH", { paymentProvider: provider });
    },
    onSuccess: (_, provider) => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      clearProviderConfigCache();
      toast({ title: "Provider updated", description: `Payment provider for ${location.name} set to ${provider === 'square' ? 'Square' : 'CardPointe'}.` });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Payment Provider</Label>
      <Select
        value={currentProvider}
        onValueChange={(val) => mutation.mutate(val as PaymentProviderType)}
        disabled={mutation.isPending}
      >
        <SelectTrigger className="w-[160px] h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="square">Square</SelectItem>
          <SelectItem value="cardpointe">CardPointe</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function SquareConfigForm({ location }: PaymentLocationCardProps) {
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
    <div className="space-y-3">
      <div className="flex items-center gap-2">
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

      {expanded && (
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Enter the Square credentials for <strong>{location.name}</strong>.
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
        </div>
      )}
    </div>
  );
}

function CardPointeConfigForm({ location }: PaymentLocationCardProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [merchantId, setMerchantId] = useState("");
  const [apiUsername, setApiUsername] = useState("");
  const [apiPassword, setApiPassword] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const { data: configResponse, isLoading } = useQuery<ApiResponse<CardPointeLocationConfig>>({
    queryKey: ["/api/locations", location.id, "cardpointe-config"],
    queryFn: async () => {
      const res = await fetch(`/api/locations/${location.id}/cardpointe-config`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const config = configResponse?.data;
  const isConfigured = !!(config?.merchantId && config?.apiPasswordConfigured);

  const mutation = useMutation({
    mutationFn: async (data: { merchantId?: string; apiUsername?: string; apiPassword?: string; siteUrl?: string }) => {
      return apiRequest(`/api/locations/${location.id}/cardpointe-config`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", location.id, "cardpointe-config"] });
      clearProviderConfigCache();
      toast({ title: "CardPointe settings saved", description: `CardPointe credentials for ${location.name} have been updated.` });
      setApiPassword("");
      setExpanded(false);
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  function handleOpen() {
    if (config) {
      setMerchantId(config.merchantId || "");
      setSiteUrl(config.siteUrl || "");
    }
    setApiUsername("");
    setApiPassword("");
    setExpanded(true);
  }

  function handleSave() {
    mutation.mutate({
      merchantId: merchantId || undefined,
      apiUsername: apiUsername || undefined,
      apiPassword: apiPassword || undefined,
      siteUrl: siteUrl || undefined,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
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

      {expanded && (
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Enter the CardPointe credentials for <strong>{location.name}</strong>.
          </p>

          <div className="space-y-2">
            <Label htmlFor={`cp-merchant-${location.id}`}>Merchant ID</Label>
            <Input
              id={`cp-merchant-${location.id}`}
              placeholder={config?.merchantId || "800000000123"}
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your CardPointe Merchant ID from your CardPointe account.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`cp-username-${location.id}`}>API Username</Label>
            <Input
              id={`cp-username-${location.id}`}
              placeholder={config?.apiUsernameConfigured ? "••••••••• (configured — enter new to replace)" : "username"}
              value={apiUsername}
              onChange={(e) => setApiUsername(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`cp-password-${location.id}`}>API Password</Label>
            <div className="relative">
              <Input
                id={`cp-password-${location.id}`}
                type={showPassword ? "text" : "password"}
                placeholder={config?.apiPasswordConfigured ? "••••••••••••••• (configured — enter new to replace)" : "password"}
                value={apiPassword}
                onChange={(e) => setApiPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              API credentials from your CardPointe Gateway account.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`cp-site-${location.id}`}>Site URL</Label>
            <Input
              id={`cp-site-${location.id}`}
              placeholder={config?.siteUrl || "fts-uat.cardconnect.com"}
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The CardPointe gateway hostname (e.g., fts.cardconnect.com for production).
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
        </div>
      )}
    </div>
  );
}

function PaymentLocationCard({ location }: PaymentLocationCardProps) {
  const provider = (location.paymentProvider as PaymentProviderType) || 'square';
  const isCardPointe = provider === 'cardpointe';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isCardPointe ? 'bg-blue-600' : 'bg-black'}`}>
              {isCardPointe ? (
                <CreditCard className="h-5 w-5 text-white" />
              ) : (
                <SiSquare className="h-5 w-5 text-white" />
              )}
            </div>
            <div>
              <CardTitle className="text-base">{location.name}</CardTitle>
            </div>
          </div>
          <ProviderSelector location={location} />
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-4">
        {isCardPointe ? (
          <CardPointeConfigForm location={location} />
        ) : (
          <SquareConfigForm location={location} />
        )}
      </CardContent>
    </Card>
  );
}

interface SquareSectionProps {
  orgId: number;
}

export function SquareSection({ orgId }: SquareSectionProps) {
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
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-black to-blue-600 flex items-center justify-center shrink-0">
          <CreditCard className="h-5 w-5 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Payment Processing</h3>
          <p className="text-xs text-muted-foreground">Square or CardPointe — configured per location</p>
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
              No active locations found for this organization. Add a location first to configure payment processing.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {locations.map((location) => (
            <PaymentLocationCard key={location.id} location={location} />
          ))}
        </div>
      )}
    </div>
  );
}
