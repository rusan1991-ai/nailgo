import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import { MarketplaceHeader } from "./MarketplaceHeader";
import { MessengerBanner } from "./MessengerBanner";

type PublicPageShellProps = {
  title: string;
  children: ReactNode;
  /** Set false when the page already has its own heading in the article body. */
  showHeading?: boolean;
  /** Avoid a duplicate picker when the page owns a city/region control. */
  showRegionPicker?: boolean;
};

/** Shared public-page frame: marketplace header, editorial canvas and real site footer. */
export function PublicPageShell({
  title,
  children,
  showHeading = true,
  showRegionPicker = true,
}: PublicPageShellProps) {
  const { user } = useAuth();

  return (
    <div className="n2g-public-inner w-full min-w-0" data-public-inner>
      <MarketplaceHeader showRegionPicker={showRegionPicker} />
      <main className="n2g-public-page-content mx-auto w-full min-w-0 max-w-[1480px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10" data-public-page>
        {showHeading && (
          <div className="mb-6" data-public-page-heading>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#E58E82]">nail2go</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
          </div>
        )}
        {user && <MessengerBanner settingsTo="/settings" className="mb-5" />}
        {children}
      </main>
    </div>
  );
}
