import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Academic Thai Translator",
  description:
    "Translate English documents and scans into formal academic Thai with configurable providers and QA.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-800 font-sans">
        {children}
      </body>
    </html>
  );
}
