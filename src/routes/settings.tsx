import SettingPage from "@/pages/settings";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: () => <SettingPage />,
});
