import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

app.registerExtension({
  name: "Pixaroma.Notify",

  settings: [
    {
      id: "Pixaroma.Notify.Enabled",
      name: "Enabled",
      type: "boolean",
      defaultValue: true,
      tooltip:
        "Master switch for all Notify Pixaroma nodes. When off, no Notify node plays sound.",
      category: ["👑 Pixaroma", "Notify"],
    },
  ],

  setup() {
    api.addEventListener("executed", (e) => {
      const out = e?.detail?.output?.pixaroma_notify;
      if (!Array.isArray(out) || out.length === 0) return;
      const masterOn =
        app.ui.settings.getSettingValue("Pixaroma.Notify.Enabled") !== false;
      if (!masterOn) {
        console.log("[Notify Pixaroma] muted (master toggle off)");
        return;
      }
      for (const ev of out) {
        console.log(
          `[Notify Pixaroma] (received) ${ev.label}  (${ev.sound} @ ${ev.volume}%)`
        );
      }
    });
  },
});
