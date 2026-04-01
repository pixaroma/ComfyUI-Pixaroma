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
};
