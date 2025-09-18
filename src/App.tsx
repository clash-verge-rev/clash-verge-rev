import Layout from "./pages/_layout";
import { AppDataProvider } from "./providers/app-data-provider";

function App() {
  return (
    <AppDataProvider>
      <Layout />
    </AppDataProvider>
  );
}

export default App;
