import { useQuery } from "@tanstack/react-query";
import { getSubdomainSlug } from "@/lib/subdomain";

interface SubdomainOrg {
  id: number;
  name: string;
  slug: string;
  logo: string | null;
  darkLogo: string | null;
}

export function useSubdomainOrg() {
  const slug = getSubdomainSlug();

  const { data, isLoading } = useQuery<{ success: boolean; data: SubdomainOrg | null }>({
    queryKey: ["/api/org-context"],
    staleTime: 1000 * 60 * 60,
    enabled: true,
  });

  return {
    org: data?.data ?? null,
    slug,
    isSubdomain: slug !== null,
    isLoading,
  };
}
