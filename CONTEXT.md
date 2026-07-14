# Apify (v2)

Browser automation platform: record a repetitive browser task once, replay it with new inputs on demand, on a headless server-side browser. Includes a marketplace where creators resell their automations to other users per run.

## Language

**Automation**:
A single recorded browser task, parameterized into variable fields, replayable on demand.
_Avoid_: Task, script, bot

**Recording**:
The one-time act of performing a task in the browser extension so Apify can learn its steps.

**Variable field**:
A recorded input (text, dropdown, calendar, tickmark/checkbox, or nested field) that changes between runs — e.g. destination, date, guest count.
_Avoid_: Parameter (except in API docs context)

**Nested field**:
A variable field that only appears after interacting with another field (e.g. a stepper revealing a per-child age dropdown).
_Avoid_: Sub-field, fields within fields

**Fallback chain**:
The ordered set of signals (label text, position, DOM structure, etc.) tried in sequence to relocate a field on replay before falling back to AI.

**AI field resolution**:
A live-page AI scan used only when the fallback chain fails to relocate a field — not run on every replay.
_Avoid_: AI scan (every run)

**Quoted rate**:
The per-run price Apify charges an automation's owner, set at creation time from compute cost + complexity + platform margin. Always collected in full by the platform on every run, marketplace or not.
_Avoid_: Base price, cost

**Resale price**:
The per-run price a seller sets for marketplace buyers. Must be >= quoted rate. The amount above quoted rate is the margin, split 70% seller / 30% platform. Currency: BDT (tk).
_Avoid_: Listing price

**Creator**:
The user who recorded and owns an automation.

**Seller**:
A Pro-tier creator who has listed their automation on the marketplace for others to buy runs of.
_Avoid_: Vendor, publisher

**Buyer**:
A user who pays to run someone else's automation via the marketplace. Sees only the variable-field form and the output — never the recorded steps/selectors.
_Avoid_: Customer, runner

**Run**:
The single unified unit consumed by both creating an automation and executing one. Drawn from a monthly pool with a daily ceiling. Marketplace runs are pay-per-use and never draw from this pool.
_Avoid_: Credit, creation attempt (as a separate counter)

**Derived key**:
A per-buyer API key issued when a buyer purchases access to a marketplace automation. Tracks that buyer's usage/billing independently and is revoked if the creator pulls the listing. The creator retains ownership/license of the underlying automation; buyers are only ever issued a derived key, never the creator's own key.
_Avoid_: Shared key, buyer's own key (implying full ownership)

**Multi-site automation**:
A single automation whose recording spans more than one website. Data piping between sites (output of one site feeding an input on another) is optional, toggled per automation by its creator.
_Avoid_: Cross-site flow

**Per-site login toggle**:
A setting, independent per site within a multi-site automation, controlling whether that site's run stays logged in using a saved session.

**Output count**:
A dropdown (5 / 10 / 20 / 50) choosing how many results to scrape, selected by whoever runs the automation (not fixed by the creator). Quoted rate scales proportionally with it; resale price is the creator's per-unit rate × count.

## Pricing tiers

- **Free**: 150 runs/month, 10/day ceiling, max 5/day of which may be creations. No marketplace selling.
- **Builder** (1,500 BDT/mo): 600 runs/month, 30/day ceiling. No marketplace selling.
- **Pro** (3,500 BDT/mo): 1,800 runs/month, 90/day ceiling. Marketplace seller access.
- **Enterprise**: custom pricing, team accounts.

Once a plan's pool is exhausted, additional runs are billed at the quoted rate.

Billing via a dummy "dCash" site + transaction-ID verification (real bKash deferred — cost).
