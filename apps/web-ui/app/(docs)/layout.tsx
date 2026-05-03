import 'fumadocs-ui/style.css';
import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      {children}
    </RootProvider>
  );
}
