// Pixaroma 3D — API helpers
import { api } from "/scripts/api.js";

export class ThreeDAPI {
    static async saveRender(projectId, dataURL) {
        const res = await api.fetchApi("/pixaroma/api/3d/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projectId, image_merged: dataURL }),
        });
        return res.json();
    }

    static async uploadBgImage(projectId, dataURL) {
        const res = await api.fetchApi("/pixaroma/api/3d/bg_upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projectId, image: dataURL }),
        });
        return res.json();
    }
}
