import { lazy, Suspense } from "react";
import { useChangelogStore } from "./internal/changelog-store";

const ChangelogSheet = lazy(() =>
  import("./internal/changelog-sheet").then((module) => ({
    default: module.ChangelogSheet,
  })),
);

/** Mounted once by the app shell so any surface can call `openChangelog()`. */
export function ChangelogHost() {
  const visible = useChangelogStore((state) => state.visible);
  const close = useChangelogStore((state) => state.close);
  if (!visible) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <ChangelogSheet visible={visible} onClose={close} />
    </Suspense>
  );
}
