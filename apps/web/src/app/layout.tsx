import type { Metadata } from "next";
import { DM_Sans, Fraunces } from "next/font/google";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "HighLife — Faster Approvals. More Homes.",
  description:
    "HighLife automates building design policy approval with computer vision and AI—so compliant homes move from drawing board to construction in days, not months.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${fraunces.variable}`}>
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
