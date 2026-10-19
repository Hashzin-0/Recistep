import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { AppHeader } from "@/components/app-header";
import { Motion } from "@/components/motion";

export const metadata: Metadata = {
  title: "Recistep — cozinhe no seu ritmo",
  description:
    "Organize receitas, ingredientes e etapas de preparo em um só lugar.",
  applicationName: "Recistep",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#14120f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js');",
          }}
        />
        <AuthProvider>
          <Motion />
          <AppHeader />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
