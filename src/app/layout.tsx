import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LocaleProvider } from "@/components/LocaleProvider";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { readLocaleCookie } from "@/lib/i18n/server-locale";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ShopStack",
  description: "Multi-tenant point of sale SaaS for managing companies, stores, and warehouses.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading the locale cookie opts the whole tree into dynamic rendering,
  // which is what lets a signed-in account come back in its own language.
  const locale = await readLocaleCookie();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-slate-50 text-slate-950">
        <LocaleProvider locale={locale} dictionary={getDictionary(locale)}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
