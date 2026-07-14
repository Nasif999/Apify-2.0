# Marketplace revenue: quoted rate off the top, then 70/30 on the margin

**Context.** Every automation run has a real platform compute cost, captured at creation time as the *quoted rate* (compute + complexity + platform margin). On the marketplace, a seller sets a *resale price* ≥ quoted rate.

**Decision.** On each marketplace run, the platform first takes the full quoted rate off the top (this covers its own compute cost and base margin). The remainder (resale price − quoted rate) is the *margin*, split 70% seller / 30% platform. Example: quoted 5tk, resale 15tk → platform keeps 5tk + 3tk = 8tk, seller gets 7tk.

**Why.** A flat 70/30 on the whole resale price would leave the platform's 30% below its actual per-run compute cost whenever a seller prices near the floor — a guaranteed loss per run. Taking the quoted rate off the top guarantees the platform never runs a marketplace automation at a loss, regardless of how the seller prices.

**Consequences.** The resale-price floor must equal the quoted rate (never below). Quoted rate scales proportionally with output count (5/10/20/50), so the split recomputes per run based on the count the runner selects.
