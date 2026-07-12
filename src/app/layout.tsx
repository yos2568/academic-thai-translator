import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Academic Thai Translator v2",
  description:
    "Extract PDF/DOCX/TXT with images, translate via Grok OAuth into formal academic Thai, and export textbook-ready documents.",
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
