"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/services/api";

type StatusResponse = {
  subscription: {
    status: "pending" | "active" | "expired" | "cancelled" | "none";
    isPremium: boolean;
    daysRemaining: number | null;
  };
  ads: {
    isEnabled: boolean;
    placement: "modal" | "fullscreen";
    countdownSeconds: number;
    frequencyMinutes: number;
    adsenseClientId: string | null;
    adUnitId: string | null;
  };
};

const LAST_SHOWN_KEY = "shopstack_ad_last_shown";

/**
 * Mounted once in both company/layout.tsx and store/layout.tsx so the
 * free-tier ad gate and premium reminder banner apply company-wide, not
 * just to the admin. Polls /api/company/subscription/status on mount and
 * on an interval (ad settings' frequencyMinutes) - see spec section 2/4.
 */
export function AdGate({ role }: { role: "company_admin" | "store_manager" | "store_user" }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [showAd, setShowAd] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const scriptLoaded = useRef(false);

  async function checkStatus() {
    try {
      const result = await apiFetch<StatusResponse>("/api/company/subscription/status");
      setData(result);

      if (!result.subscription.isPremium && result.ads.isEnabled) {
        const lastShown = Number(localStorage.getItem(LAST_SHOWN_KEY) ?? 0);
        const dueAgainAt = lastShown + result.ads.frequencyMinutes * 60_000;
        if (Date.now() >= dueAgainAt) {
          setSecondsLeft(result.ads.countdownSeconds);
          setShowAd(true);
        }
      }
    } catch {
      // Fail silent - a broken status check should never block the app from rendering.
    }
  }

  useEffect(() => {
    async function init() {
      await checkStatus();
    }
    init();
    const interval = setInterval(checkStatus, 5 * 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!showAd || secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [showAd, secondsLeft]);

  useEffect(() => {
    if (!showAd || !data?.ads.adsenseClientId || scriptLoaded.current) return;
    scriptLoaded.current = true;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${data.ads.adsenseClientId}`;
    script.crossOrigin = "anonymous";
    document.head.appendChild(script);
  }, [showAd, data]);

  function handleClose() {
    localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
    setShowAd(false);
  }

  const subscription = data?.subscription;
  const showExpiringBanner =
    subscription?.status === "active" && subscription.daysRemaining !== null && subscription.daysRemaining <= 7;
  const showExpiredBanner = subscription?.status === "expired" || subscription?.status === "none";

  return (
    <>
      {showExpiringBanner || showExpiredBanner ? (
        <div className="bg-amber-50 px-6 py-2 text-center text-sm text-amber-800">
          {showExpiringBanner
            ? `🟡 Your premium subscription expires in ${subscription!.daysRemaining} day${subscription!.daysRemaining === 1 ? "" : "s"}.`
            : "⚫ Your premium subscription has expired."}
          {role === "company_admin" ? (
            <>
              {" "}
              <Link href="/company/subscription" className="font-semibold underline">
                Renew now
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      {showAd && data ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-950">Advertisement</p>
              {secondsLeft > 0 ? (
                <span className="text-xs text-slate-500">You can close this ad in {secondsLeft}s</span>
              ) : (
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-white"
                >
                  Close
                </button>
              )}
            </div>
            <div className="mt-4 flex min-h-[250px] items-center justify-center rounded-2xl bg-slate-100">
              {data.ads.adsenseClientId && data.ads.adUnitId ? (
                <ins
                  className="adsbygoogle"
                  style={{ display: "block", width: "100%", minHeight: 250 }}
                  data-ad-client={data.ads.adsenseClientId}
                  data-ad-slot={data.ads.adUnitId}
                  ref={(el) => {
                    if (el && !el.dataset.rendered) {
                      el.dataset.rendered = "true";
                      try {
                        (window as unknown as { adsbygoogle: unknown[] }).adsbygoogle =
                          (window as unknown as { adsbygoogle: unknown[] }).adsbygoogle || [];
                        (window as unknown as { adsbygoogle: unknown[] }).adsbygoogle.push({});
                      } catch {
                        // AdSense script may not be ready yet - safe to ignore.
                      }
                    }
                  }}
                />
              ) : (
                <p className="p-8 text-center text-sm text-slate-500">
                  Ad space - configure a Google AdSense Client ID and Ad Unit ID in the Super Admin ad settings to
                  show real ads here.
                </p>
              )}
            </div>
            {role === "company_admin" ? (
              <p className="mt-4 text-center text-xs text-slate-500">
                <Link href="/company/subscription" className="font-semibold underline">
                  Go premium
                </Link>{" "}
                to remove ads.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
