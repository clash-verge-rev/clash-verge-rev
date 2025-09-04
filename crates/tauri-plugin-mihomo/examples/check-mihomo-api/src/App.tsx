import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { getGroups } from "tauri-plugin-mihomo-api";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";

function App() {
  const [response, setResponse] = useState("");

  async function format_json(text: string) {
    return await invoke<string>("cmd_format_json", { text });
  }

  async function check() {
    try {
      // await upgradeCore();
      let data = await getGroups();
      const formattedJson = await format_json(JSON.stringify(data));
      setResponse(formattedJson);
    } catch (err: any) {
      setResponse(err.toString());
    }
  }

  return (
    <main style={{ backgroundColor: "white" }}>
      <div className="row">
        <button
          onClick={() => {
            check();
          }}>
          Check
        </button>
      </div>
      <CodeMirror
        style={{ marginTop: "10px", textAlign: "left" }}
        width="100%"
        height="85dvh"
        minHeight="480px"
        value={response}
        theme={"dark"}
        extensions={[json()]}
      />
    </main>
  );
}

export default App;
