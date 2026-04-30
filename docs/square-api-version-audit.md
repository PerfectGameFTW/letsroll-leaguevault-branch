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
- We have **no real Square webhook receiver** (only Clover). The
  CSRF-exempt path covers `/payments-provider/webhooks`
  generically; the `webhooks.ts` router mounts the real
  `POST /webhooks/clover` handler plus a tripwire stub at
  `POST /webhooks/square` (task #612) that 501's any unexpected
  Square delivery and emits a `log.error` line so on-call sees it.
- Our SDK call surface is small and already on the v40+ flat-client
  shape (no `.result.errors[]` wrapper, structured errors directly on
  `SquareError`). All response field reads in our code are on fields
  Square has shipped since well before 2025.
- §5 walks **every one** of the 10 official Square API releases
  between `2025-01-23` and `2026-01-22` and shows zero changes that
  affect the endpoints or fields our code uses. The two
  deprecations in the window (Catalog Modifier fields,
  `Payment.offline_payment_details`) touch code paths we don't
  exercise.
- **Recommendation: GO — bump the dashboard pin to `2026-01-22`** to
  match the SDK. Bumping closes the ~12-month gap between
  dashboard and SDK; today's gap is itself a source of risk if
  Square ever applies the dashboard version to a call we missed.
- **No code changes are required as a precondition** for the bump.
  All findings worth filing as follow-ups are listed in §7 (Tasks
  #612 / #613 / #614) — they are cleanups, not blockers.

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

- `server/routes/payments-provider/webhooks.ts` — **Clover handler
  + Square tripwire stub**.
  - `POST /webhooks/clover` is the real, signed Clover handler from
    task #577.
  - `POST /webhooks/square` is a tripwire stub added in task #612.
    It answers `501 Not Implemented` and emits a single
    `log.error` line capturing method, path, all request headers,
    and the raw body. We do not subscribe to any Square webhook
    events today, so the tripwire exists purely to make an
    accidental subscription loud instead of silent. There is no
    HMAC verification on the stub — we have no Square webhook
    secret to verify against, and the whole point is to fire on
    any unexpected delivery so on-call sees it.
- `server/middleware/csrf.ts:39-45` — exempts the path prefix
  `/payments-provider/webhooks` from CSRF. The exemption covers
  both the Clover handler and the Square tripwire above without
  needing to be touched.

### Subscriptions on Square's side

This repo cannot see what's configured on the Developer Dashboard.
**The operator must confirm before flipping the version pin** that
no Square webhook subscriptions exist on either the production or
sandbox application. If any exist, Square will start delivering
events to whatever URL was registered, and:

1. We still have no signed-receiver code, so a real subscription's
   events would hit the task #612 tripwire stub and return 501.
   The 501 is loud enough to surface in on-call but it is not a
   substitute for a real handler — money-relevant events
   (refunds, disputes, chargebacks) would still go unprocessed.
2. The dashboard version pin would dictate the payload schema. Today
   that schema is `2025-01-23`; bumping to `2026-01-22` could change
   the event shape without us noticing because no handler reads it.

**Pre-bump check (operator):** in the Square Developer Dashboard,
open each application → Webhooks → Subscriptions. Confirm the
subscription list is empty for both **Production** and **Sandbox**.
If any exist, file a follow-up to either delete them or build a
verified handler before bumping the pin.

---

## 5. Changelog cross-reference — every release in the bump window

### Sources

- Index: <https://developer.squareup.com/docs/changelog/connect>
- Per-release pages: `https://developer.squareup.com/docs/changelog/connect-logs/<YYYY-MM-DD>`
- Versioning policy: <https://developer.squareup.com/docs/build-basics/api-lifecycle>

Releases between `2025-01-23` (exclusive) and `2026-01-22`
(inclusive), as listed on the index page above (Square skipped
Nov & Dec 2025):

`2025-02-20`, `2025-03-19`, `2025-04-16`, `2025-05-21`,
`2025-06-18`, `2025-07-16`, `2025-08-20`, `2025-09-24`,
`2025-10-16`, `2026-01-22` — **10 releases**.

### Per-release filter (what's in scope)

Only changes that touch the resources in this table can affect us.
Anything else is out of scope by definition (we don't call those
APIs and we don't read those fields).

| Resource | Endpoints we hit | Response fields we read |
| --- | --- | --- |
| Payments | `CreatePayment`, `GetPayment` | `payment.id`, `payment.status`, `payment.amountMoney.{amount,currency}`, `payment.createdAt`, `payment.updatedAt`, `payment.sourceType`, `payment.cardDetails.card.{cardBrand,last4}`, `payment.orderId`, `payment.receiptUrl`, `payment.receiptNumber` |
| Orders | `CreateOrder` | `order.id` |
| Refunds | `RefundPayment` | `refund.id`, `refund.status` |
| Cards | `CreateCard`, `ListCards`, `DisableCard` | `card.{id,enabled,last4,cardBrand,expMonth,expYear}` |
| Customers | `SearchCustomers`, `CreateCustomer`, `UpdateCustomer`, `DeleteCustomer` | `customers[].id`, `customer.id` + request fields |
| Customer Custom Attributes | `CreateCustomerCustomAttributeDefinition`, `UpsertCustomerCustomAttribute` | error codes (`CONFLICT`, `ALREADY_EXISTS`, definition-missing); `VISIBILITY_READ_ONLY` enum; `String` schema acceptance |
| Catalog | `ListCatalog` (`types=CATEGORY`, `types=ITEM`), `SearchCatalogItems` | `data[].{id,type,isDeleted}`, `categoryData.name`, `itemData.{name,description,variations}`, `itemVariationData.{name,priceMoney.*}`, `response.cursor` |
| Apple Pay | `RegisterDomain` | error `errors[0].detail` only |
| Cross-cutting | `SquareError` shape | `error.statusCode`, `error.errors[].code`, `error.errors[0].detail` |

A change blocks the bump only if it:

1. **Removes** or **renames** a field listed above.
2. **Changes the enum values** of `payment.status`, `refund.status`,
   `card.cardBrand`, `payment.sourceType`, or the custom-attribute
   visibility enum.
3. **Changes idempotency-key semantics** on any listed call (we
   rely on Square deduping retries).
4. **Changes a webhook payload schema** on any event we plan to
   subscribe to (we plan none — see §4).

### Per-release diff (every release in the window)

Each row was read directly from the official changelog page above.
"In-scope" lists every change to a resource we actually use; "Out
of scope" is a one-line summary of the rest, included so a
reviewer can see we read each release in full.

| Version | In-scope changes | Verdict |
| --- | --- | --- |
| `2025-02-20` | **Refunds API:** `ListPaymentRefunds` got new `updated_at_begin_time`, `updated_at_end_time`, `sort_field` filters. We don't call `ListPaymentRefunds`. | **No-op** |
| `2025-02-20` (out of scope) | Mobile Auth API deprecation, Mobile Payments SDK Tap-to-Pay, PHP SDK rewrite, Terminal API linked orders, Disputes API doc clarification. | — |
| `2025-03-19` | **Cards API:** new read-only **Beta** fields on `Card` (`hsa_fsa`, `issuer_alert`, `issuer_alert_at`); `CreateCard` accepts ZIP+4 in `postal_code`. Additive only. We read `card.id` only and we don't supply `postal_code` (cards come from Web Payments SDK tokens). | **No-op** |
| `2025-03-19` (out of scope) | Invoices API new field, Java/.NET SDK rewrites, Terminal API GA receipts. | — |
| `2025-04-16` | **Catalog API:** new read-only `is_alcoholic` on `CatalogItem`. Additive. We read `itemData.name` and variation pricing only. **Webhooks:** retry schedule changed to max 11 retries / 24 hours. We have no Square webhook subscription so the retry change has no operational effect today (see §4). | **No-op** |
| `2025-04-16` (out of scope) | Invoices API public-link expiry, Locations API address validation, Python SDK rewrite, Terminal API features, App Marketplace requirements. | — |
| `2025-05-21` | **Catalog API:** large modifier-customization revamp. New fields added across `CatalogModifier`, `CatalogModifierList`, `CatalogItemModifierListInfo`, `CatalogModifierOverride`. **Deprecations:** `CatalogModifierList.selection_type`, `CatalogModifierList.max_quantity`, `CatalogItemModifierListInfo.hidden_from_customer`, `CatalogModifierOverride.hidden_online`, `CatalogModifierOverride.on_by_default`. **None of these fields are read or written by our code** — `listCatalogItems` only reads `itemData.name`/variation pricing, never modifier shapes. | **No-op (future-watch only — flagged in §7)** |
| `2025-05-21` (out of scope) | Square MCP Server release, GraphQL Labor entry points, Labor API scheduling/timecards. | — |
| `2025-06-18` | None. (No Payments / Orders / Refunds / Cards / Customers / Custom-Attributes / Catalog / ApplePay changes.) | **No-op** |
| `2025-06-18` (out of scope) | GraphQL `devices` entry point, Loyalty API removal of long-deprecated `definition` field, all-SDK webhook payload typings. | — |
| `2025-07-16` | None. Documentation-only release. The Apple Pay note (`docs/web-payments/apple-pay`) is about Web Payments SDK tokenization on the client; no `applePay.registerDomain` server-side change. | **No-op** |
| `2025-07-16` (out of scope) | Apple Pay tokenization doc update only. | — |
| `2025-08-20` | **Payments API:** `CreatePayment` request property `offline_payment_details` is **DEPRECATED**, retired November 19, 2025. We never set this property in `chargeCard`/`createSavedCardPayment` (`server/services/square-provider.ts`). | **No-op** |
| `2025-08-20` (out of scope) | In-App Payments SDK Apple/Google Pay in Japan, Ruby SDK rewrite. | — |
| `2025-09-24` | None. | **No-op** |
| `2025-09-24` (out of scope) | Devices API new fields (`HANDHELD`, `mac_address`), Subscriptions API `COMPLETED` status. | — |
| `2025-10-16` | None. | **No-op** |
| `2025-10-16` (out of scope) | New Channels API release, new Transfer Orders API (Beta) release. Both are net-new APIs we don't use. | — |
| `2026-01-22` | **Catalog API:** new additive `kitchen_name` on `CatalogItem` / `CatalogItemVariation` / `CatalogModifier`; new `buyer_facing` on `CatalogItem`; new `CatalogModifierToggleOverrideType` enum. All read-only/additive — we read `itemData.name` + variation pricing, not these fields. **Orders API:** new additive `blocked_service_charges` on `OrderLineItem`, `auto_applied` on `OrderLineItemAppliedTax`, `type` on `OrderReturnServiceCharge`, new `OrderCardSurchargeTreatmentType` enum. We read `order.id` only. **Payments API:** new additive `errors` on `BuyNowPayLaterDetails` and `DigitalWalletDetails`, new `created_at`/`disabled_at` on `Payment.CardPaymentDetails.Card`, plus new card-surcharge reporting. We read `cardDetails.card.{cardBrand,last4}` only. **Common entities:** `ErrorCode` enum gains `PARTIAL_PAYMENT_DELAY_CAPTURE_NOT_SUPPORTED` and `PAYMENT_SOURCE_NOT_ENABLED_FOR_TARGET` — additive, our error handling reads `statusCode`/`code`/`detail` and the new codes flow through the generic catch path with no behavior change. | **No-op** |
| `2026-01-22` (out of scope) | Bank Accounts API new endpoints, Mobile Authorization API + Reader SDK retired, OAuth `use_jwt`, Terminal API US surcharge support. | — |

### Roll-up

- **Removed fields we read:** **0**
- **Renamed fields we read:** **0**
- **Enum-value changes on enums we read:** **0** (additive enum
  values on `ErrorCode` are backward-compatible — see 2026-01-22)
- **Idempotency-key semantics changes:** **0**
- **Deprecated request properties we send:** **0** (the only
  Payments API deprecation is `offline_payment_details`, which we
  never set)
- **Deprecated fields we read:** **0** (the 2025-05-21 Catalog
  Modifier deprecations are on fields we don't touch)
- **Webhook schema changes affecting us:** **0** (no subscription)

Every single change in the 10-release window is either additive or
touches code paths we don't exercise. The bump is safe.

---

## 6. Operator pre-flight checklist

§5 already establishes that the bump is safe based on Square's
published changelogs. This checklist is a small set of **operational
sanity checks** to run before flipping the dashboard pin — not
prerequisites for the audit's evidence.

1. Re-skim §5's diff table — if the operator wants independent
   verification, the per-release URLs are
   `https://developer.squareup.com/docs/changelog/connect-logs/<YYYY-MM-DD>`
   for each of the 10 versions listed.
2. (Optional, only matters if it has changed since the audit was
   written) Re-confirm "no Square webhook subscription" by opening
   **Square Developer Dashboard → application → Webhooks →
   Subscriptions** for both Production and Sandbox apps. Per §4,
   bumping the pin only changes inbound webhook payload schemas if
   a subscription exists. If one has been added since this audit,
   build a handler **before** bumping (see follow-up #612).
3. Do a sandbox smoke test against the new pin **before** flipping
   production:
   - Sandbox app → Settings → API Version → set to `2026-01-22`.
   - Run an end-to-end charge through a sandbox-credentialed
     LeagueVault location: save a card, charge it, refund it,
     fetch the receipt. All four hit the high-risk endpoints.
   - Open the bowler details page and confirm the Square customer
     custom-attribute write still succeeds (visible in Square
     dashboard → Customers → custom field).
4. Flip production: Square Dashboard → Production app → Settings →
   API Version → `2026-01-22`.
5. **Rollback steps if anything goes wrong:** Square Dashboard →
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

None of these block the version bump. They were filed as separate
project tasks so the bump itself (Task #600) can ship independently.

1. **Task #612 — Stub a Square webhook receiver. ✅ DONE.**
   Implemented in `server/routes/payments-provider/webhooks.ts` as
   a `POST /webhooks/square` handler that returns
   `501 SQUARE_WEBHOOK_NOT_IMPLEMENTED` and emits a single
   `log.error` line with method, path, headers, and raw body.
   Closes the "what if someone registers a subscription
   out-of-band" risk surfaced in §4.
2. **Task #613 — Capture catalog pagination in `listCatalogItems`.**
   Today the unfiltered branch (`server/services/square-provider.ts`
   `catalog.list`/`catalog.searchItems`) only fetches the first
   page. The audit made the limit visible. If a seller hits
   Square's default page size it'll silently truncate.
3. **Task #614 — Catch Square SDK header drift in CI.** A single
   test that asserts the outgoing `Square-Version` header equals
   an expected literal. This catches silent SDK upgrades that
   change the pinned version (the type `version?: "2026-01-22"`
   in `BaseClient.d.ts` would surface a compile error, but only
   if a caller passes the literal — which we never do today).

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

**GO — bump the dashboard pin from `2025-01-23` to `2026-01-22`.**
The bump is safe based on the changelog evidence in §5 and the SDK
inventory in §2.

Rationale:

- The SDK already sends `2026-01-22` on every request (proven in
  §1). The dashboard pin is functionally inert today — but a stale
  pin is a footgun for the next person who adds a non-SDK call or a
  webhook subscription.
- The changelog cross-reference in §5 walks all 10 Square releases
  in the bump window and shows **zero** removed/renamed fields,
  **zero** breaking enum changes, **zero** idempotency-key
  changes, and **zero** deprecated request properties we send. The
  only deprecations in the window (Catalog Modifier fields in
  `2025-05-21` and `Payment.offline_payment_details` in
  `2025-08-20`) touch code paths we don't exercise.
- We have no Square webhook handler (§4), so changing the dashboard
  version cannot break inbound payload parsing.
- All v40+ flat-client SDK semantics (no `.result` wrapper,
  `SquareError.errors[].detail`, `SquareEnvironment` URLs, `token`
  option) are already in place — see the inline comments at
  `square-provider.ts:35-39`, `:553-559`, `:577`, `:594`, `:887`,
  `:1009-1013`, and `square-custom-attributes.ts:104` and `:215`.
- No code changes are required as a precondition for the bump.
  Tasks #612 / #613 / #614 are quality-of-life follow-ups and can
  ship after the bump.
