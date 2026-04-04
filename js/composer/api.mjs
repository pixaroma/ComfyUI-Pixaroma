import { api } from "/scripts/api.js";

export const PixaromaAPI = {
    async removeBg(b64) {
        const res = await api.fetchApi("/pixaroma/remove_bg", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: b64 })
        });
        return await res.json();
    },

    async uploadLayer(id, b64) {
        const res = await api.fetchApi("/pixaroma/api/layer/upload", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ layer_id: id, image: b64 })
        });
        return await res.json();
    },

    async saveProject(projId, finalDataURL) {
        const res = await api.fetchApi("/pixaroma/api/project/save", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projId, image_merged: finalDataURL })
        });
        return await res.json();
    }
};
