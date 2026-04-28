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
import { ChevronUp, CheckCircle2, Eye, EyeOff, Pencil, CreditCard, AlertTriangle } from "lucide-react";
import { SiSquare } from "react-icons/si";
import type { ApiResponse, Location, PaymentProviderType } from "@shared/schema";
import { CLOVER_FIELD_LABELS, getMissingCloverFields, SQUARE_FIELD_LABELS, getMissingSquareFields } from "@shared/schema";
import { clearProviderConfigCache } from "@/hooks/use-payment-provider";

interface SquareLocationConfig {
  appId: string | null;
  accessTokenConfigured: boolean;
  locationId: string | null;
}

interface CloverLocationConfig {
  merchantId: string | null;
  apiTokenConfigured: boolean;
  publicTokenizerKey: string | null;
  environment: 'sandbox' | 'production' | null;
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
      toast({ title: "Provider updated", description: `Payment provider for ${location.name} set to ${provider === 'square' ? 'Square' : 'Clover'}.` });
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
          <SelectItem value="clover">Clover</SelectItem>
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
  // "Configured" means *all three* required Square fields are present.
  // "Partial" means at least one field is set but at least one is
  // missing — surface this so admins can see exactly what's left to
  // fill in instead of being told only "Not configured" or seeing a
  // broken card form at checkout (task #579, mirrors task #575 for
  // Clover).
  const squareMissingFields = getMissingSquareFields(config ?? null);
  const filledSquareFieldCount = 3 - squareMissingFields.length;
  const isConfigured = squareMissingFields.length === 0;
  const isPartial = !isConfigured && filledSquareFieldCount > 0;

  const mutation = useMutation({
    mutationFn: async (data: { appId?: string; accessToken?: string; locationId?: string }) => {
      return apiRequest(`/api/locations/${location.id}/square-config`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", location.id, "square-config"] });
      clearProviderConfigCache();
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
      <div className="flex items-center gap-2 flex-wrap">
        {isLoading ? (
          <div className="h-5 w-24 bg-muted animate-pulse rounded-full" />
        ) : isConfigured ? (
          <Badge className="bg-green-100 text-green-700 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Configured
          </Badge>
        ) : isPartial ? (
          <Badge className="bg-amber-100 text-amber-800 border-amber-200" data-testid="badge-square-partial">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Partial setup
          </Badge>
        ) : (
          <Badge variant="outline">Not configured</Badge>
        )}
        {(isConfigured || isPartial) && !expanded ? (
          <Button variant="outline" size="sm" onClick={handleOpen}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            {isPartial ? 'Finish setup' : 'Edit'}
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

      {!isLoading && isPartial && !expanded && (
        <p
          className="text-xs text-amber-700"
          data-testid="text-square-missing-fields"
        >
          Missing: {squareMissingFields.map((f) => SQUARE_FIELD_LABELS[f]).join(', ')}.
          Card payments will be unavailable until every field is filled in.
        </p>
      )}

      {expanded && (
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Enter the Square credentials for <strong>{location.name}</strong>.
          </p>

          {isPartial && (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
              data-testid="alert-square-missing-fields-form"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">Square is partially configured</div>
                  <div className="text-xs mt-1">
                    Still needed: {squareMissingFields.map((f) => SQUARE_FIELD_LABELS[f]).join(', ')}.
                  </div>
                </div>
              </div>
            </div>
          )}

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

function CloverConfigForm({ location }: PaymentLocationCardProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [merchantId, setMerchantId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [publicTokenizerKey, setPublicTokenizerKey] = useState("");
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [showToken, setShowToken] = useState(false);

  const { data: configResponse, isLoading } = useQuery<ApiResponse<CloverLocationConfig>>({
    queryKey: ["/api/locations", location.id, "clover-config"],
    queryFn: async () => {
      const res = await fetch(`/api/locations/${location.id}/clover-config`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const config = configResponse?.data;
  // "Configured" means *all four* required Clover fields are present.
  // "Partial" means at least one field is set but at least one is
  // missing — surface this so admins can see exactly what's left to
  // fill in instead of being told only "Not configured" or seeing a
  // broken card form at checkout (task #575).
  const cloverMissingFields = getMissingCloverFields(config ?? null);
  const filledFieldCount = 4 - cloverMissingFields.length;
  const isConfigured = cloverMissingFields.length === 0;
  const isPartial = !isConfigured && filledFieldCount > 0;

  const mutation = useMutation({
    mutationFn: async (data: { merchantId?: string; apiToken?: string; publicTokenizerKey?: string; environment?: 'sandbox' | 'production' }) => {
      return apiRequest(`/api/locations/${location.id}/clover-config`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", location.id, "clover-config"] });
      clearProviderConfigCache();
      toast({ title: "Clover settings saved", description: `Clover credentials for ${location.name} have been updated.` });
      setApiToken("");
      setExpanded(false);
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  function handleOpen() {
    if (config) {
      setMerchantId(config.merchantId || "");
      setPublicTokenizerKey(config.publicTokenizerKey || "");
      setEnvironment((config.environment as 'sandbox' | 'production') || 'sandbox');
    }
    setApiToken("");
    setExpanded(true);
  }

  function handleSave() {
    mutation.mutate({
      merchantId: merchantId || undefined,
      apiToken: apiToken || undefined,
      publicTokenizerKey: publicTokenizerKey || undefined,
      environment,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {isLoading ? (
          <div className="h-5 w-24 bg-muted animate-pulse rounded-full" />
        ) : isConfigured ? (
          <Badge className="bg-green-100 text-green-700 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Configured
          </Badge>
        ) : isPartial ? (
          <Badge className="bg-amber-100 text-amber-800 border-amber-200" data-testid="badge-clover-partial">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Partial setup
          </Badge>
        ) : (
          <Badge variant="outline">Not configured</Badge>
        )}
        {(isConfigured || isPartial) && !expanded ? (
          <Button variant="outline" size="sm" onClick={handleOpen}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            {isPartial ? 'Finish setup' : 'Edit'}
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

      {!isLoading && isPartial && !expanded && (
        <p
          className="text-xs text-amber-700"
          data-testid="text-clover-missing-fields"
        >
          Missing: {cloverMissingFields.map((f) => CLOVER_FIELD_LABELS[f]).join(', ')}.
          Card payments will be unavailable until every field is filled in.
        </p>
      )}

      {expanded && (
        <div className="space-y-4 pt-2">
          <p className="text-sm text-muted-foreground">
            Enter the Clover credentials for <strong>{location.name}</strong>.
          </p>

          {isPartial && (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
              data-testid="alert-clover-missing-fields-form"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">Clover is partially configured</div>
                  <div className="text-xs mt-1">
                    Still needed: {cloverMissingFields.map((f) => CLOVER_FIELD_LABELS[f]).join(', ')}.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`cv-merchant-${location.id}`}>Merchant ID</Label>
            <Input
              id={`cv-merchant-${location.id}`}
              placeholder={config?.merchantId || "ABC1234567890"}
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your Clover Merchant ID, found in your Clover Dashboard under Account &amp; Setup.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`cv-token-${location.id}`}>API Token</Label>
            <div className="relative">
              <Input
                id={`cv-token-${location.id}`}
                type={showToken ? "text" : "password"}
                placeholder={config?.apiTokenConfigured ? "••••••••••••••• (configured — enter new token to replace)" : "Clover Ecommerce API token"}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
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
              Private Ecommerce API token from your Clover Developer Dashboard. Used server-side only.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`cv-pak-${location.id}`}>Public Tokenizer Key</Label>
            <Input
              id={`cv-pak-${location.id}`}
              placeholder={config?.publicTokenizerKey || "pk_..."}
              value={publicTokenizerKey}
              onChange={(e) => setPublicTokenizerKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Public Apple Pay/tokenization key from your Clover account. Sent to the browser to render the secure card form.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`cv-env-${location.id}`}>Environment</Label>
            <Select
              value={environment}
              onValueChange={(val) => setEnvironment(val as 'sandbox' | 'production')}
            >
              <SelectTrigger id={`cv-env-${location.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Use Sandbox for testing and Production for live charges.
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
  const isClover = provider === 'clover';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isClover ? 'bg-emerald-600' : 'bg-black'}`}>
              {isClover ? (
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
        {isClover ? (
          <CloverConfigForm location={location} />
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
          <p className="text-xs text-muted-foreground">Square or Clover — configured per location</p>
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
