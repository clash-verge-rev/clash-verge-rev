import TestPage from "@/pages/test";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/test")({
  component: () => <TestPage />,
});
