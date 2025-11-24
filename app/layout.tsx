import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Casino MVP",
  description: "優質的加密貨幣娛樂平台",
  // 強制深色主題設定
  themeColor: "#0b0b0b",
  other: {
    "color-scheme": "dark",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className="bg-[#0b0b0b]">
      <head>
        {/* 告訴瀏覽器整站以深色模式呈現 */}
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#0b0b0b" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0b0b0b] text-zinc-100`}
      >
        {children}
      </body>
    </html>
  );
}
