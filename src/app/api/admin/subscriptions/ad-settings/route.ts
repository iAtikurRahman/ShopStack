import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-guard";
import { centralDb } from "@/lib/central-db";
import { getAdSettings } from "@/lib/subscription";

export const GET = withAuth(async () => {
  const adSettings = await getAdSettings();
  return NextResponse.json({ adSettings });
}, { scope: "project_admin" });

export const PUT = withAuth(async (request) => {
  const body = await request.json().catch(() => null);
  const { adsenseClientId, adUnitId, placement, countdownSeconds, isEnabled, frequencyMinutes } = body ?? {};

  if (placement !== undefined && placement !== "modal" && placement !== "fullscreen") {
    return NextResponse.json({ message: "placement must be 'modal' or 'fullscreen'" }, { status: 400 });
  }
  if (countdownSeconds !== undefined && (!Number.isInteger(countdownSeconds) || countdownSeconds < 1)) {
    return NextResponse.json({ message: "countdownSeconds must be a positive whole number" }, { status: 400 });
  }
  if (frequencyMinutes !== undefined && (!Number.isInteger(frequencyMinutes) || frequencyMinutes < 1)) {
    return NextResponse.json({ message: "frequencyMinutes must be a positive whole number" }, { status: 400 });
  }

  await getAdSettings(); // ensure the row exists before updating

  const adSettings = await centralDb.advertisementSettings.update({
    where: { id: 1 },
    data: {
      ...(adsenseClientId !== undefined ? { adsenseClientId: adsenseClientId || null } : {}),
      ...(adUnitId !== undefined ? { adUnitId: adUnitId || null } : {}),
      ...(placement !== undefined ? { placement } : {}),
      ...(countdownSeconds !== undefined ? { countdownSeconds } : {}),
      ...(isEnabled !== undefined ? { isEnabled: Boolean(isEnabled) } : {}),
      ...(frequencyMinutes !== undefined ? { frequencyMinutes } : {}),
    },
  });

  return NextResponse.json({ adSettings });
}, { scope: "project_admin" });
