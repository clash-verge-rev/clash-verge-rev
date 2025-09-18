import { AppDataProvider } from "./providers/app-data-provider";
import Layout from "./pages/_layout";

function App() {
  return (
    <AppDataProvider>
      <Layout />
    </AppDataProvider>
  );
}

export default App;
