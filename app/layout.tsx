import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const title = "Body Weather — Experience Atlas";
  const description = "Strava와 Garmin ZIP을 브라우저 안에서 분석해, 평생의 운동 경로와 회복 리듬을 지도·예보·추억 포스터로 펼칩니다.";
  return {
    metadataBase: base,
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", images: [{ url: new URL("/og-atlas.png", base), width: 1672, height: 941, alt: "빛나는 운동 경로가 날씨 흐름처럼 겹쳐진 Body Weather Experience Atlas" }] },
    twitter: { card: "summary_large_image", title, description, images: [new URL("/og-atlas.png", base)] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  const plausibleScript = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL || (plausibleDomain ? "https://plausible.io/js/script.js" : "");
  const plausibleInit = "window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()";
  return (
    <html lang="ko">
      {plausibleScript && <head><script async data-domain={plausibleDomain || undefined} src={plausibleScript} /><script dangerouslySetInnerHTML={{ __html: plausibleInit }} /></head>}
      <body>{children}</body>
    </html>
  );
}
