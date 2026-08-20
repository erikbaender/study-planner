import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { ThemeProvider, ThemeScript } from "@/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "Study Planner",
  description: "Plan courses, topics and exams, and track how much material is left.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // `suppressHydrationWarning` is scoped to <html> and is required rather than
    // convenient: `ThemeScript` writes `data-theme` before React hydrates, so
    // the attribute always differs from what the server rendered.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full bg-window text-label">
        <ThemeProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
