import RulesPage from "@/pages/rules";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/rules")({
  component: () => <RulesPage />,
});
