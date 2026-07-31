import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { getSubscriptionStatus, getAdSettings } from "@/lib/subscription";

// Read-only status check, available to every tenant role (not just
// company_admin) since the ad-gate/reminder banner applies company-wide.
export const GET = withAuth(async (_request, { session }) => {
  const [subscription, adSettings] = await Promise.all([
    getSubscriptionStatus(session.companyId),
    getAdSettings(),
  ]);

  return NextResponse.json({
    subscription,
    ads: {
      isEnabled: adSettings.isEnabled,
      placement: adSettings.placement,
      countdownSeconds: adSettings.countdownSeconds,
      frequencyMinutes: adSettings.frequencyMinutes,
      adsenseClientId: adSettings.adsenseClientId,
      adUnitId: adSettings.adUnitId,
    },
  });
}, { scope: "tenant", roles: ["company_admin", "store_manager", "store_user"] });
