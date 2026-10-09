import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { View } from "react-native";

const fillStyle = { flex: 1 };

interface CompactExplorerSidebarHostLoaderProps {
  children: ReactNode;
  enabled: boolean;
  presentation: "overlay" | "dock";
}

type CompactExplorerSidebarHostComponent = ComponentType<CompactExplorerSidebarHostLoaderProps>;

/**
 * The heavy host stays out of the module graph until compact layout actually
 * mounts this loader. Desktop web never renders it, so it never starts the import.
 */
export function CompactExplorerSidebarHostLoader({
  children,
  enabled,
  presentation,
}: CompactExplorerSidebarHostLoaderProps) {
  const [Host, setHost] = useState<CompactExplorerSidebarHostComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("./compact-explorer-sidebar-host").then((module) => {
      if (!cancelled) {
        setHost(() => module.CompactExplorerSidebarHost);
      }
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Host) {
    return <View style={fillStyle}>{children}</View>;
  }

  return (
    <Host enabled={enabled} presentation={presentation}>
      {children}
    </Host>
  );
}
