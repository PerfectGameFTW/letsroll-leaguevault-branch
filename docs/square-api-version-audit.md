# Square API Version Audit

**Status:** Investigation only — no production behavior changes in this commit.
**Filed under:** Task #611
**Date:** 2026-04-29
**Scope:** All Square API surface area in this repo, plus a recommendation
on whether it is safe to bump the **Square Developer Dashboard** API
version pin from `2025-01-23` to a current version.

---

## TL;DR

- Installed SDK: **`square@44.0.1`** (per `package.json`).
- The SDK already sends **`Square-Version: 2026-01-22`** on every
  outbound request — independently of the dashboard pin.
- We make **zero raw HTTP** calls to Square. 100% of our wire goes
  through the SDK client.
- We have **no Square webhook receiver** (only Clover). The CSRF-
  exempt path covers `/payments-provider/webhooks` generically; the
  `webhooks.ts` router only mounts a `POST /webhooks/clover` handler.
- Our SDK call surface is small and already on the v40+ flat-client
  shape (no `.result.errors[]` wrapper, structured errors directly on
  `SquareError`). All response field reads in our code are on fields
  Square has shipped since well before 2025.
- **Recommendation: GO — bump the dashboard pin to `2026-01-22`** to
  match the SDK, after the operator runs the verification checklist
  in §6 against Square's published release notes. Bumping closes the
  ~12-month gap between dashboard and SDK; today's gap is itself a
  source of risk if Square ever applies the dashboard version to a
  call we missed.
- **No code changes are required as a precondition** for the bump.
  All findings worth filing as follow-ups are listed in §7 — they are
  cleanups, not blockers.

---

## 1. SDK's effective `Square-Version` header

The header is baked into the installed SDK and is what actually
shows up on the wire today.

| Where | What |
| --- | --- |
| `package.json` (root) | `"square": "^44.0.1"` |
| `node_modules/square/package.json` | `"version": "44.0.1"` |
| `node_modules/square/BaseClient.d.ts:9` | `version?: "2026-01-22";` |
| `node_modules/square/BaseClient.js:51` | `"Square-Version": (... options.version) ?? "2026-01-22"` |
| Per-resource clients (e.g. `api/resources/disputes/client/Client.js:104`, `customers/.../client/Client.js`, every other generated client) | Same fallback literal: `"Square-Version": ... ?? "2026-01-22"` |

In other words, **every method call from the SDK explicitly sets the
header to `2026-01-22`** unless the caller passes a per-call
`requestOptions.version` override (we never do).

### Implication for the dashboard pin

The dashboard's "default API version" pin (`2025-01-23` today)
controls two things:

1. The default applied to API calls **that do not send their own
   `Square-Version` header** — i.e. raw HTTP calls bypassing the SDK.
2. The schema version of webhook event payloads Square sends to **us**.

Neither of those applies to us today: we have no raw HTTP calls (§3)
and no Square webhook handler (§4). So the header value already on
the wire is `2026-01-22`. The dashboard pin is, in practice, dead
weight — but a stale pin is still a footgun the day someone adds a
raw call or registers a webhook subscription.

---

## 2. SDK call-site inventory

Grouped by Square API resource so this lines up directly with
Square's changelog sections. Every line was found via:

```sh
rg -n -g '!node_modules' -g '!dist' \
   "client\.(payments|refunds|orders|customers|cards|catalog|applePay)" \
   "squareClient\."
```

Plus `customers.customAttributeDefinitions` and `customers.customAttributes`
which sit nested under the customers resource.

The "Response fields read" column lists exactly what our code
dereferences off the SDK response object — these are the fields the
audit needs to verify against the changelog.

### Payments

| Site | Method | Request fields we send | Response fields we read |
| --- | --- | --- | --- |
| `server/services/square-provider.ts:128` (`processPayment`) | `client.payments.create` | `sourceId`, `idempotencyKey`, `amountMoney.{amount,currency}`, `autocomplete`, `customerId?`, `buyerEmailAddress?` | `payment.id`, `payment.status`, `payment.cardDetails.card.{last4,cardBrand}`, `payment.receiptUrl`, `payment.receiptNumber` |
| `server/services/square-provider.ts:265` (`createOrderWithPayment`) | `client.payments.create` | Same as above + `orderId`, `locationId` | Same as above |
| `server/services/square-provider.ts:839` (`getPayment`) | `client.payments.get` | `paymentId` | `payment.id`, `payment.status`, `payment.amountMoney.{amount,currency}`, `payment.createdAt`, `payment.updatedAt`, `payment.sourceType`, `payment.cardDetails.card.{cardBrand,last4}`, `payment.orderId`, `payment.receiptUrl`, `payment.receiptNumber` |

### Orders

| Site | Method | Request fields we send | Response fields we read |
| --- | --- | --- | --- |
| `server/services/square-provider.ts:230` (`createOrderWithPayment`) | `client.orders.create` | `order.{locationId,lineItems}`, `idempotencyKey` | `order.id` only |

`lineItems` is typed as `OrderLineItem[]` from our internal
`payment-provider.ts` shim and passed straight through to the SDK,
so its concrete fields (`name`, `quantity`, `basePriceMoney`, etc.)
travel as-is. We do not read any line-item field back off the
response.

### Refunds

| Site | Method | Request fields we send | Response fields we read |
| --- | --- | --- | --- |
| `server/services/square-provider.ts:345` (`refundPayment`) | `client.refunds.refundPayment` | `idempotencyKey`, `paymentId`, `amountMoney.{amount,currency}`, `reason` | `refund.id`, `refund.status` |

### Cards

| Site | Method | Request fields we send | Response fields we read |
| --- | --- | --- | --- |
| `server/services/square-provider.ts:437` (`saveCardOnFile`) | `client.cards.create` | `idempotencyKey`, `sourceId`, `card.customerId` | `card.id`, `card.last4`, `card.cardBrand` |
| `server/services/square-provider.ts:477` (`listCardsOnFile`) | `client.cards.list` | `customerId` | `page.data[].{id,enabled,last4,cardBrand,expMonth,expYear}` |
| `server/services/square-provider.ts:508` (`disableCard` membership check) | `client.cards.list` | `customerId` | `page.data[].id` |
| `server/services/square-provider.ts:515` (`disableCard`) | `client.cards.disable` | `cardId` | (no fields read; void on success) |

### Customers

| Site | Method | Request fields we send | Response fields we read |
| --- | --- | --- | --- |
| `server/services/square-provider.ts:543` (`createOrUpdateCustomer`) | `client.customers.search` | `query.filter.emailAddress.exact` | `customers[0].id` |
| `server/services/square-provider.ts:578` (`createOrUpdateCustomer`) | `client.customers.update` | `customerId`, `givenName`, `familyName`, `emailAddress`, `phoneNumber?`, `referenceId?` | `customer` (presence check); `customer.id` (logged in dev at `:591`) |
| `server/services/square-provider.ts:594` (`createOrUpdateCustomer`) | `client.customers.create` | `idempotencyKey`, `givenName`, `familyName`, `emailAddress`, `phoneNumber?`, `referenceId?` | `customer.id` |
| `server/services/square-provider.ts:812` (`deleteCustomer`) | `client.customers.delete` | `customerId` | (we swallow `NOT_FOUND`; otherwise void) |
| `server/scripts/create-square-customers.ts:225` (one-shot backfill script) | `client.customers.create` | `idempotencyKey`, `givenName`, `familyName`, `emailAddress`, `referenceId` | `customer.id` |

### Customer custom attributes

| Site | Method | Request fields we send | Response fields we read |
| --- | --- | --- | --- |
| `server/services/square-custom-attributes.ts:105` (`createDefinition`) | `client.customers.customAttributeDefinitions.create` | `customAttributeDefinition.{key,name,description,visibility:'VISIBILITY_READ_ONLY',schema}`, `idempotencyKey` | (no response field read; success vs. `isAlreadyExistsError(err)`) |
| `server/services/square-custom-attributes.ts:217` (`upsertCustomerStringAttribute`) | `client.customers.customAttributes.upsert` | `customerId`, `key`, `customAttribute.value`, `idempotencyKey` | (no response field read; success vs. `isDefinitionMissingError(err)`) |

The two attribute keys we own on the seller account are
`league_name` and `league_season` (constants `LEAGUE_NAME_KEY` /
`LEAGUE_SEASON_KEY` in `square-custom-attributes.ts`). Schema is
`STRING_SCHEMA` per the same file.

### Catalog

| Site | Method | Request fields we send | Response fields we read |
| --- | --- | --- | --- |
| `server/services/square-provider.ts:890` (`listCatalogCategories`) | `client.catalog.list` | `cursor?`, `types: 'CATEGORY'` | `page.data[].{id,type,isDeleted,categoryData.name}`, `page.response.cursor` |
| `server/services/square-provider.ts:967` (`listCatalogItems` filtered) | `client.catalog.searchItems` | `categoryIds: [categoryId]` | `response.items[].{id,type,itemData.{name,description,variations[].{id,type,itemVariationData.{name,priceMoney.{amount,currency}}}}}` |
| `server/services/square-provider.ts:980` (`listCatalogItems` unfiltered) | `client.catalog.list` | `types: 'ITEM'` | Same shape as `searchItems` above |

### Apple Pay

| Site | Method | Request fields we send | Response fields we read |
| --- | --- | --- | --- |
| `server/services/square-provider.ts:1005` (`registerApplePayDomain`) | `client.applePay.registerDomain` | `domainName` | (no fields read; success/failure only; on error we surface `error.errors[0].detail`) |

### Errors (cross-cutting)

Anywhere we catch a `SquareError` we read these fields off it
(verified at `square-provider.ts:168/300/387/1013`,
`square-custom-attributes.ts` error helpers, and the one-shot
backfill script's rate-limit branch at
`server/scripts/create-square-customers.ts:264`):

- `error.statusCode` (number; the script also branches on `=== 429`)
- `error.errors[0].detail` (string, log-only / surfaced on Apple Pay failure)
- `error.errors[].code` (used by `isAlreadyExistsError` / `isDefinitionMissingError`)

These are SDK-level fields, not wire fields, so they are tied to the
SDK version (44.0.1), not the dashboard pin.

---

## 3. Raw HTTP Square calls — confirmed zero

Searched with:

```sh
rg -n -g '!node_modules' -g '!dist' "fetch\(.*square|axios.*square|https?\.request.*square" -i
rg -n -g '!node_modules' -g '!dist' "https://(connect|pci-connect)\.square" -i
rg -n -g '!node_modules' -g '!dist' "squareup\.com/v2"
```

All hits in the source tree are non-runtime (no `fetch`, `axios`,
`got`, or `https.request` targets a Square host). Categorized:

- **CSP allow-list** — `server/middleware/security.ts:35-60` lists
  `connect.squareup.com`, `connect.squareupsandbox.com`,
  `pci-connect.squareup.com`, `pci-connect.squareupsandbox.com`.
  These permit the **client-side Web Payments SDK** to talk to Square;
  no server-side fetch.
- **Browser hints** — `client/index.html:22-24` has
  `<link rel="preconnect">` / `dns-prefetch` for
  `pci-connect.squareup.com` / `connect.squareup.com`. Mirrored into
  `android/app/src/main/assets/public/index.html` and
  `ios/App/App/public/index.html`.
- **Dashboard deep-links (anchor `href`s)** — non-runtime, just
  navigation:
  - `client/src/components/bowler-payment-history-table.tsx:50` →
    `https://squareup.com/dashboard/payments/{providerPaymentId}`
  - `client/src/pages/messaging-page.tsx:180` →
    `https://app.squareup.com/dashboard/customers/directory`
  - `client/src/lib/square.ts:547` →
    `https://app.squareup.com/dashboard/customers/directory/customer/{customerId}`
- **Schema reference (string literal sent in a request body, not a
  URL we fetch)** — `server/services/square-custom-attributes.ts:50`
  embeds `https://developer.squareup.com/schemas/v1/common.json#squareup.common.String`
  as the `$ref` value of the `STRING_SCHEMA` payload posted to
  `customers.customAttributeDefinitions.create`. Square dereferences
  the URL on its own side; we never `fetch` it. The literal is part
  of the request shape and so should be re-verified if Square
  republishes the schema CDN under a new URL.

**All Square wire traffic goes through `square@44.0.1`'s flat
client. No raw HTTP.**

---

## 4. Square webhook posture

### Receivers in this repo

- `server/routes/payments-provider/webhooks.ts` — **Clover only**. Per
  task #577 the file mounts a single handler at `POST /webhooks/clover`.
  No `POST /webhooks/square` route exists.
- `server/middleware/csrf.ts:39-45` — exempts the path prefix
  `/payments-provider/webhooks` from CSRF. The comment explicitly
  reads "Clover today; Square may follow," confirming the exemption
  is forward-compatible but no Square handler is mounted yet.

### Subscriptions on Square's side

This repo cannot see what's configured on the Developer Dashboard.
**The operator must confirm before flipping the version pin** that
no Square webhook subscriptions exist on either the production or
sandbox application. If any exist, Square will start delivering
events to whatever URL was registered, and:

1. We have no signed-receiver code to verify them with — so they
   would land at a 404 (or worse, get treated as a Clover event by
   the path-prefix CSRF exemption if the URL was registered under
   `/payments-provider/webhooks/...`).
2. The dashboard version pin would dictate the payload schema. Today
   that schema is `2025-01-23`; bumping to `2026-01-22` could change
   the event shape without us noticing because no handler reads it.

**Pre-bump check (operator):** in the Square Developer Dashboard,
open each application → Webhooks → Subscriptions. Confirm the
subscription list is empty for both **Production** and **Sandbox**.
If any exist, file a follow-up to either delete them or build a
verified handler before bumping the pin.

---

## 5. Methodology for the changelog cross-reference

This audit was authored without live web access from the build
environment. The tables in §2 give the operator the **exact list of
endpoints and response fields** to verify against Square's published
release notes. Use the methodology below to do the verification — it
should take ~20 minutes once and then ~5 minutes per future bump.

### Inputs

- **Current dashboard pin:** `2025-01-23`
- **Target dashboard pin:** `2026-01-22` (the SDK's current default)
- **Released versions to walk** (Square ships roughly monthly):
  enumerate them at <https://developer.squareup.com/docs/build-basics/api-lifecycle>
  and <https://developer.squareup.com/changelog>.

### Per-release filter

For each release between `2025-01-23` exclusive and `2026-01-22`
inclusive, only changes to the resources in the table below matter
to us. Skip everything else.

| Resource | Endpoints we hit | Response fields we read (must remain shipped) |
| --- | --- | --- |
| Payments | `CreatePayment`, `GetPayment` | `payment.id`, `payment.status`, `payment.amountMoney.{amount,currency}`, `payment.createdAt`, `payment.updatedAt`, `payment.sourceType`, `payment.cardDetails.card.{cardBrand,last4}`, `payment.orderId`, `payment.receiptUrl`, `payment.receiptNumber` |
| Orders | `CreateOrder` | `order.id` |
| Refunds | `RefundPayment` | `refund.id`, `refund.status` |
| Cards | `CreateCard`, `ListCards`, `DisableCard` | `card.{id,enabled,last4,cardBrand,expMonth,expYear}` |
| Customers | `SearchCustomers`, `CreateCustomer`, `UpdateCustomer`, `DeleteCustomer` | `customers[].id`, `customer.id`, request fields `givenName`, `familyName`, `emailAddress`, `phoneNumber`, `referenceId`, idempotency-key behavior |
| Customer Custom Attributes | `CreateCustomerCustomAttributeDefinition`, `UpsertCustomerCustomAttribute` | error codes only (`CONFLICT`, `ALREADY_EXISTS`, definition-missing); `VISIBILITY_READ_ONLY` enum value; `Selection`/`String` schema acceptance |
| Catalog | `ListCatalog` (`types=CATEGORY`, `types=ITEM`), `SearchCatalogItems` | `data[].{id,type,isDeleted}`, `categoryData.name`, `itemData.{name,description,variations}`, `itemVariationData.{name,priceMoney.{amount,currency}}`, `response.cursor` |
| Apple Pay | `RegisterDomain` | error `errors[0].detail` only |

### What to flag as breaking

A change in any of the following blocks the bump:

1. **Removal** of any field listed above.
2. **Rename** of any field listed above (Square's pattern is to
   add the new field, deprecate the old, then remove — only the
   removal step is breaking).
3. **Enum value change** on `payment.status`, `refund.status`,
   `card.cardBrand`, `payment.sourceType`, or
   `customAttributeDefinition.visibility`.
4. **Idempotency-key semantics change** on any of the calls listed
   above (we rely on Square deduping retries).
5. **Webhook payload schema change** on any event we ever plan to
   subscribe to. (Currently none — see §4.)

Anything outside that list is irrelevant to us, even if Square
flags it as a breaking change in their changelog.

---

## 6. Operator verification checklist

Run this **before** flipping the dashboard pin from `2025-01-23` to
`2026-01-22`.

1. Open <https://developer.squareup.com/changelog> and the
   "API releases" section of the lifecycle docs.
2. List every released `YYYY-MM-DD` version `> 2025-01-23` and
   `<= 2026-01-22`.
3. For each release, scan only the sections matching the
   resources in §5's table. Check for the five "flag" categories
   in §5.
4. For each Square Developer Dashboard application
   (Production **and** Sandbox), open Webhooks → Subscriptions
   and confirm the list is empty. If not, do **not** bump until
   the subscriptions are either removed or a verified handler is
   built.
5. Do a sandbox smoke test against the new pin **before** flipping
   production:
   - Sandbox app → Settings → API Version → set to `2026-01-22`.
   - Run an end-to-end charge through a sandbox-credentialed
     LeagueVault location: save a card, charge it, refund it,
     fetch the receipt. All four hit the high-risk endpoints.
   - Open the bowler details page and confirm the Square customer
     custom-attribute write still succeeds (visible in Square
     dashboard → Customers → custom field).
6. Flip production: Square Dashboard → Production app → Settings →
   API Version → `2026-01-22`.
7. **Rollback steps if anything goes wrong:** Square Dashboard →
   same page → set the version back to `2025-01-23`. The SDK header
   continues to send `2026-01-22` regardless, so this rollback only
   restores the *default* applied to non-SDK callers (i.e. nothing
   we own) and the webhook payload shape (we receive none). If a
   true regression is observed against our SDK calls, the rollback
   is to **downgrade the `square` package**, not to flip the
   dashboard. Pin to a known-good version from `package-lock.json`
   history.

---

## 7. Findings filed as follow-ups (non-blocking)

None of these block the version bump. They are quality-of-life
items surfaced by the audit; file each as a fresh task only if the
operator agrees.

1. **Add a `Square-Version` integration test.** A single test that
   mocks the SDK's `fetch` adapter and asserts the outgoing
   `Square-Version` header equals an expected literal. This catches
   silent SDK upgrades that change the pinned version (the type
   `version?: "2026-01-22"` in `BaseClient.d.ts` would surface a
   compile error, but only if a caller passes the literal — which
   we never do today).
2. **Document the dashboard pin in `replit.md`.** A two-line note
   under "External services" that records: "Square Dashboard API
   version pin = `2026-01-22` (kept aligned with the `square` npm
   package's default header to avoid silent schema drift)." The
   pin is otherwise tribal knowledge.
3. **Stub a Square webhook receiver.** Even without a registered
   subscription, having a `POST /webhooks/square` handler that
   returns 410 Gone (with structured logging on the body) closes
   the "what if someone registers a subscription out-of-band"
   risk surfaced in §4.
4. **Capture catalog pagination in `listCatalogItems`.** Today the
   unfiltered branch (`square-provider.ts:980`) only fetches the
   first page. This was deliberate (per the inline comment), but
   the audit makes the limit visible. If a seller hits >1000
   catalog items it'll silently truncate.

---

## 8. How to redo this audit

When you bump the `square` package or want to re-pin the dashboard:

1. `grep '"square"' package.json` and `cat node_modules/square/BaseClient.js | grep Square-Version` — confirm the SDK header literal.
2. `rg -n -g '!node_modules' -g '!dist' "client\.(payments|refunds|orders|customers|cards|catalog|applePay)" "squareClient\."` — re-list every SDK call site. Diff against §2 of this doc; add new rows.
3. `rg -n -g '!node_modules' -g '!dist' "fetch\(.*square|axios.*square|https?\.request.*square" -i` and the same for the host literals — confirm raw-HTTP count is still zero.
4. `rg -n "webhooks/square|/webhooks/" server/routes/payments-provider/` — confirm the receiver inventory matches §4.
5. Walk the §6 checklist for the new release window.
6. Commit the updated audit. The whole loop should fit in 30
   minutes if the SDK call surface hasn't grown much.

---

## 9. Final recommendation

**GO — bump the dashboard pin from `2025-01-23` to `2026-01-22`,**
contingent on the operator finishing §6's checklist (especially the
empty-subscription confirmation in step 4 and the sandbox smoke
test in step 5).

Rationale:

- The SDK already sends `2026-01-22` on every request. The dashboard
  pin is functionally inert today — but a stale pin is a footgun for
  the next person who adds a non-SDK call or a webhook subscription.
- All response fields our code reads (§2, §5) are core, long-shipped
  Square fields. Whether any have been moved to Square's deprecation
  list since `2025-01-23` was **not** verifiable from this build
  environment — that confirmation is the operator's job in §6 step 3.
- We have no Square webhook handler, so changing the dashboard
  version cannot break inbound payload parsing.
- All v40+ flat-client SDK semantics (no `.result` wrapper,
  `SquareError.errors[].detail`, `SquareEnvironment` URLs, `token`
  option) are already in place — see the inline comments at
  `square-provider.ts:35-39`, `:553-559`, `:577`, `:594`, `:887`,
  `:1009-1013`, and `square-custom-attributes.ts:104` and `:215`.
- No code changes are required as a precondition for the bump (§7
  items are quality-of-life only).
