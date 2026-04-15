import { api } from "/scripts/api.js";

export const PixaromaAPI = {
  // Accept either a model id ("u2net" / "isnet-general-use" / etc.)
  // or a legacy quality tier ("normal" / "high"). Backend now maps
  // both to a real model name and returns `modelUsed`.
  async removeBg(b64, model = "auto") {
    const res = await api.fetchApi("/pixaroma/remove_bg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: b64, model }),
    });
    return await res.json();
  },

  // Ask the backend which rembg models are installed / available /
  // already downloaded. Used by the composer panel to build the
  // quality dropdown and show status + install hints.
  async removeBgInfo() {
    try {
      const res = await api.fetchApi("/pixaroma/remove_bg_info", { method: "GET" });
      return await res.json();
    } catch (e) {
      return { rembgInstalled: false, models: [] };
    }
  },

  async uploadLayer(id, b64) {
    const res = await api.fetchApi("/pixaroma/api/layer/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layer_id: id, image: b64 }),
    });
    return await res.json();
  },

  async saveProject(projId, finalDataURL) {
    const res = await api.fetchApi("/pixaroma/api/project/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projId, image_merged: finalDataURL }),
    });
    return await res.json();
  },
};
