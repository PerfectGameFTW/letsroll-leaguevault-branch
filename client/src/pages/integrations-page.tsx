import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle } from "lucide-react";
import type { ApiResponse, Location, Organization, User } from "@shared/schema";
import { BowlNowCard, type BowlNowConfig } from "@/components/bowlnow-integration-card";
import { SquareSection } from "@/components/square-integration-section";

interface IntegrationsConfig {
  bowlnow: BowlNowConfig;
}

interface IntegrationsContentProps {
  orgId: number;
  highlightLocationId: number | null;
}

function IntegrationsContent({ orgId, highlightLocationId }: IntegrationsContentProps) {
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
      <SquareSection orgId={orgId} highlightLocationId={highlightLocationId} />
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

  // Read the optional `?location=<id>` deep-link query param emitted by
  // the checkout's "not configured" alert / toast (tasks #582, #583).
  // Only accept positive integers — anything else is ignored so the page
  // still loads cleanly when the link is malformed (task #584).
  const search = useSearch();
  const highlightLocationId = useMemo(() => {
    const raw = new URLSearchParams(search).get("location");
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }, [search]);

  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);

  // When a deep link is present, look up the location so we can route a
  // system admin to the correct organization automatically (regular admins
  // only ever see their own org). The query is non-blocking: a 404 / 403 /
  // network error just leaves the page on the user's default org so the
  // page "still loads cleanly with no error" per the task spec.
  const { data: highlightLocationResponse } = useQuery<ApiResponse<Location>>({
    queryKey: ["/api/locations", highlightLocationId],
    queryFn: async () => {
      const res = await fetch(`/api/locations/${highlightLocationId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch location: ${res.status}`);
      return res.json();
    },
    enabled: highlightLocationId != null,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const highlightLocationOrgId = highlightLocationResponse?.data?.organizationId ?? null;

  // Auto-select the location's org for system admins so they don't have
  // to hunt for it in the dropdown after following the deep link. We only
  // overwrite an empty selection — never the admin's manual choice — so
  // navigating back to the page after switching orgs doesn't snap back.
  useEffect(() => {
    if (!isSystemAdmin) return;
    if (selectedOrgId != null) return;
    if (highlightLocationOrgId == null) return;
    setSelectedOrgId(highlightLocationOrgId);
  }, [isSystemAdmin, selectedOrgId, highlightLocationOrgId]);

  const effectiveOrgId = isSystemAdmin
    ? (selectedOrgId ?? highlightLocationOrgId ?? currentUser?.organizationId ?? null)
    : (currentUser?.organizationId ?? null);

  const { data: orgsResponse } = useQuery<ApiResponse<Organization[]>>({
    queryKey: ["/api/organizations"],
    enabled: isSystemAdmin,
    staleTime: 1000 * 60 * 5,
  });

  const orgList = orgsResponse?.data ?? [];

  return (
    <Layout>
      <ErrorBoundary level="section">
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
        <IntegrationsContent
          key={effectiveOrgId}
          orgId={effectiveOrgId}
          highlightLocationId={highlightLocationId}
        />
      )}
      </ErrorBoundary>
    </Layout>
  );
}
