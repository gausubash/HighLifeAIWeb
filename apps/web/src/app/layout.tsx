import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "HighLife — Floor Plan Analysis",
  description: "Urban residential floor-plan analysis and compliance review platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen">
          <AppHeader />
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
