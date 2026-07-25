import type { Metadata } from "next";
import "./globals.css";
import "./accessibility.css";
import "./manual-lead.css";
import "./sales-theme.css";

export const metadata: Metadata = {
  title: "Revera Lead Control",
  description: "Operations CRM for Revera Scooter",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
