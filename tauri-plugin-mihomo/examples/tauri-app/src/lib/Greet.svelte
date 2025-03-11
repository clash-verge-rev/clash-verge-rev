<script>
  import { invoke } from "@tauri-apps/api/core"
  import { updateSecret, updateController, patchBaseConfig } from "tauri-plugin-mihomo-api"

  let name = "";
  let greetMsg = ""

  async function greet(){
    // await updateSecret(name)
    // await updateController(name)
    let data = {
      tun: {
        enable: true,
        device: "Mihomo"
      },
    };
    await patchBaseConfig(data);
  }
</script>

<div>
  <div class="row">
    <input id="greet-input" placeholder="Enter a name..." bind:value={name} />
    <button on:click={greet}>
      Greet
    </button>
  </div>
  <p>{greetMsg}</p>
</div>
