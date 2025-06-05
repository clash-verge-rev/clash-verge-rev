import LogPage from "@/pages/logs";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/logs")({
  component: () => <LogPage />,
});
