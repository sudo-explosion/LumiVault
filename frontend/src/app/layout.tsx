import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Experimanager",
  description: "3D Component Locator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
