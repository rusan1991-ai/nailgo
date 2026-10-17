import { MarketplaceHeader } from "./MarketplaceHeader";

/** Backwards-compatible public header used by booking, master and payment pages. */
export function AppHeader() {
  return <MarketplaceHeader showRegionPicker showSignOut />;
}
