import { useState } from "react";
import { TextField } from "@material-ui/core";

const HomePage = () => {
  const [port, setPort] = useState("7890");

  return (
    <div>
      <TextField
        label="Port"
        fullWidth
        value={port}
        onChange={(e) => setPort(e.target.value)}
      />
    </div>
  );
};

export default HomePage;
