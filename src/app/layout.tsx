import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { ThemeProvider, ThemeScript, TooltipProvider } from "@/ui";
import "./globals.css";

/**
 * Inter, not Geist.
 *
 * The design system's font stack asks for SF Pro, which cannot be licensed for
 * the web. Inter is the closest match in proportion and x-height, so it sits at
 * the end of the stack as the fallback for everything that is not an Apple
 * device — where `-apple-system` wins and this never loads.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Study Planner",
  description: "Plan courses, topics and exams, and track how much material is left.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // `suppressHydrationWarning` is scoped to <html> and is required rather than
    // convenient: `ThemeScript` writes `data-theme` before React hydrates, so
    // the attribute always differs from what the server rendered.
    <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full bg-window text-label">
        <ThemeProvider>
          <TooltipProvider>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
