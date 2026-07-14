# Marketplace access via derived per-buyer API keys

**Context.** When a buyer purchases access to a marketplace automation, they need a way to trigger runs via the REST API without ever seeing or owning the creator's automation. The creator retains the license/ownership of the underlying automation.

**Decision.** Each buyer is issued their own *derived key* — a distinct API key string that internally maps to the creator's automation. The creator's own key is never exposed to buyers. Per-buyer usage and billing are tracked against the derived key, and a derived key is revoked if the creator pulls the listing.

**Why.** A single shared key string across all buyers makes it impossible to attribute API calls to a specific buyer (breaking the per-buyer billing needed for the 70/30 split) and impossible to revoke one buyer's access without killing everyone's. Derived keys give per-buyer isolation, revocability, and clean billing while keeping the creator's automation fully private.

**Consequences.** The system needs a key→automation mapping table and per-key usage accounting. Revocation (creator pulls listing) must invalidate all derived keys for that automation.
