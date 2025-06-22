import { AppDataProvider } from "./providers/app-data-provider";
import Layout from "./pages/_layout";
import { useNotificationPermission } from "./hooks/useNotificationPermission";

function App() {
  useNotificationPermission();
  return (
    <AppDataProvider>
      <Layout />
    </AppDataProvider>
  );
}

export default App;
