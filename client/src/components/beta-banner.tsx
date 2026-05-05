import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { isAppEnv, type AppEnv } from "@shared/app-env";

interface OrgContextResponse {
  success: boolean;
  appEnv?: AppEnv | string;
  commit?: string;
  data?: unknown;
}

const BANNER_HEIGHT_PX = 28;

/**
 * Persistent BETA banner (Task #652). Renders a non-dismissible
 * yellow strip across the top of every page when `/api/org-context`
 * reports `appEnv: "beta"`. Includes the deploy's short commit SHA
 * so a tester filing a bug can pin "I saw this on commit abc1234".
 *
 * Reads from `/api/org-context` rather than `/api/health` so the
 * deploy's app-env / commit isn't exposed on a dedicated public
 * fingerprinting endpoint. `/api/org-context` already runs on every
 * page load via `useSubdomainOrg`, so this query just shares the
 * cache key.
 *
 * The banner is `position: fixed` and uses a `--beta-banner-height`
 * CSS variable so the admin sidebar (fixed-positioned), bowler
 * layout root (also fixed), and `<body>` padding can all anchor
 * themselves below the banner via Tailwind arbitrary values like
 * `top-[var(--beta-banner-height,0px)]`. The variable defaults to
 * `0px` (defined in `index.css`) and is set to `28px` only while
 * this component is mounted with `appEnv === "beta"` — so dev/prod
 * runtimes pay zero layout cost.
 */
export function BetaBanner() {
  const { data } = useQuery<OrgContextResponse>({
    queryKey: ['/api/org-context'],
    staleTime: 1000 * 60 * 60,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000),
  });

  const rawAppEnv = data?.appEnv;
  const appEnv: AppEnv | undefined = isAppEnv(rawAppEnv) ? rawAppEnv : undefined;
  const isBeta = appEnv === 'beta';
  const commit = typeof data?.commit === 'string' ? data.commit : 'unknown';

  useEffect(() => {
    if (!isBeta) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue('--beta-banner-height');
    root.style.setProperty('--beta-banner-height', `${BANNER_HEIGHT_PX}px`);
    return () => {
      if (previous) {
        root.style.setProperty('--beta-banner-height', previous);
      } else {
        root.style.removeProperty('--beta-banner-height');
      }
    };
  }, [isBeta]);

  if (!isBeta) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="beta-banner"
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-amber-400 text-slate-900 text-xs font-semibold tracking-wide shadow-sm"
      style={{ height: `${BANNER_HEIGHT_PX}px` }}
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>BETA ENVIRONMENT — test data only, payments use sandbox credentials</span>
      <span
        className="font-mono text-[11px] text-slate-700 hidden sm:inline"
        data-testid="beta-banner-commit"
      >
        {commit}
      </span>
    </div>
  );
}
