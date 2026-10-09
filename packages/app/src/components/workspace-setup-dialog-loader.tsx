import { lazy, Suspense } from "react";
import { useWorkspaceSetupStore } from "@/stores/workspace-setup-store";

// Named export. React.lazy requires a default, and the dialog module itself
// stays off the startup graph until a workspace setup is pending.
const WorkspaceSetupDialog = lazy(() =>
  import("./workspace-setup-dialog").then((module) => ({
    default: module.WorkspaceSetupDialog,
  })),
);

export function WorkspaceSetupDialogLoader() {
  const pendingWorkspaceSetup = useWorkspaceSetupStore((state) => state.pendingWorkspaceSetup);
  if (!pendingWorkspaceSetup) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <WorkspaceSetupDialog />
    </Suspense>
  );
}
