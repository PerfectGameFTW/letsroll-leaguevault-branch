// Minimal ambient declaration for the `proxy-addr` package.
// Upstream ships no types and `@types/proxy-addr` does not exist;
// we only consume the default export's `(req, trust)` signature in
// `server/lib/trust-proxy-check.ts`.
declare module "proxy-addr" {
  type TrustFn = (addr: string, hopIndex: number) => boolean;
  interface ProxyAddrReq {
    headers: Record<string, string | string[] | undefined>;
    connection?: { remoteAddress?: string };
    socket?: { remoteAddress?: string };
  }
  function proxyAddr(req: ProxyAddrReq, trust: TrustFn | string | string[] | number): string;
  namespace proxyAddr {
    function all(req: ProxyAddrReq, trust?: TrustFn | string | string[] | number): string[];
    function compile(val: string | string[] | number): TrustFn;
  }
  export = proxyAddr;
}
