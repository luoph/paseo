import { lazy } from "react";

function loadHostPages() {
  return import("@/screens/settings/host-page");
}

export const AppearanceSection = lazy(() =>
  import("@/screens/settings/appearance/appearance-section").then((module) => ({
    default: module.AppearanceSection,
  })),
);

export const SidebarNavSection = lazy(() =>
  import("@/screens/settings/sidebar/sidebar-nav-section").then((module) => ({
    default: module.SidebarNavSection,
  })),
);

export const ChatSection = lazy(() =>
  import("@/screens/settings/chat/chat-section").then((module) => ({
    default: module.ChatSection,
  })),
);

export const TerminalSection = lazy(() =>
  import("@/screens/settings/terminal/terminal-section").then((module) => ({
    default: module.TerminalSection,
  })),
);

export const BrowserDataSection = lazy(() =>
  import("@/desktop/browser/settings/browser-data-section").then((module) => ({
    default: module.BrowserDataSection,
  })),
);

export const EditorSection = lazy(() =>
  import("@/screens/settings/editor-section").then((module) => ({
    default: module.EditorSection,
  })),
);

export const KeyboardShortcutsSection = lazy(() =>
  import("@/screens/settings/keyboard-shortcuts-section").then((module) => ({
    default: module.KeyboardShortcutsSection,
  })),
);

export const IntegrationsSection = lazy(() =>
  import("@/desktop/components/integrations-section").then((module) => ({
    default: module.IntegrationsSection,
  })),
);

export const DesktopNotificationsSection = lazy(() =>
  import("@/desktop/components/desktop-notifications-section").then((module) => ({
    default: module.DesktopNotificationsSection,
  })),
);

export const DesktopPermissionsSection = lazy(() =>
  import("@/desktop/components/desktop-permissions-section").then((module) => ({
    default: module.DesktopPermissionsSection,
  })),
);

export const OpenLocationSection = lazy(() =>
  import("@/screens/settings/open-location/open-location-section").then((module) => ({
    default: module.OpenLocationSection,
  })),
);

export const PluginSettingsContent = lazy(() =>
  import("@/plugins/settings").then((module) => ({
    default: module.PluginSettingsContent,
  })),
);

export const HostPluginsPage = lazy(() =>
  import("@/screens/settings/plugins-page").then((module) => ({
    default: module.HostPluginsPage,
  })),
);

export const MetadataGenerationPage = lazy(() =>
  import("@/screens/settings/metadata-generation-page").then((module) => ({
    default: module.MetadataGenerationPage,
  })),
);

export const ProjectsScreen = lazy(() => import("@/screens/projects-screen"));

export const ProjectSettingsScreen = lazy(() => import("@/screens/project-settings-screen"));

export const HostConnectionsPage = lazy(() =>
  loadHostPages().then((module) => ({ default: module.HostConnectionsPage })),
);

export const HostPairDevicePage = lazy(() =>
  loadHostPages().then((module) => ({ default: module.HostPairDevicePage })),
);

export const HostAgentsPage = lazy(() =>
  loadHostPages().then((module) => ({ default: module.HostAgentsPage })),
);

export const HostWorkspacesPage = lazy(() =>
  loadHostPages().then((module) => ({ default: module.HostWorkspacesPage })),
);

export const HostProvidersPage = lazy(() =>
  loadHostPages().then((module) => ({ default: module.HostProvidersPage })),
);

export const HostUsagePage = lazy(() =>
  loadHostPages().then((module) => ({ default: module.HostUsagePage })),
);

export const HostTerminalsPage = lazy(() =>
  loadHostPages().then((module) => ({ default: module.HostTerminalsPage })),
);

export const HostSettingsPage = lazy(() =>
  loadHostPages().then((module) => ({ default: module.HostSettingsPage })),
);
