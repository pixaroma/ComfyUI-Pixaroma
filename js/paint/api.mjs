import { api } from "/scripts/api.js";

export const PaintAPI = {
  async saveComposite(projectId, dataURL) {
    const res = await api.fetchApi("/pixaroma/api/paint/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, image_merged: dataURL }),
    });
    return await res.json();
  },

  async uploadLayer(layerId, dataURL) {
    const res = await api.fetchApi("/pixaroma/api/layer/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layer_id: layerId, image: dataURL }),
    });
    return await res.json();
  },

  // Shared backend route — same one the Image Composer uses. Server
  // side accepts either a model id ("u2net" / "isnet-general-use" /
  // "birefnet-general") or "auto" (best available falls through).
  async removeBg(dataURL, model = "auto") {
    const res = await api.fetchApi("/pixaroma/remove_bg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataURL, model }),
    });
    return await res.json();
  },

  async removeBgInfo() {
    try {
      const res = await api.fetchApi("/pixaroma/remove_bg_info", {
        method: "GET",
      });
      return await res.json();
    } catch {
      return { rembgInstalled: false, models: [] };
    }
  },
};
