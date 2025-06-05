import ConnectionsPage from "@/pages/connections";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/connections")({
  component: () => <ConnectionsPage />,
});
