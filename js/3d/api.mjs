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

  // Upload a user-supplied 3D model file (GLB / GLTF / OBJ) as a
  // base64 data URL. Backend hashes contents, stores under
  // input/pixaroma/<project>/models/, and returns { status, path }
  // where `path` is the `pixaroma/...` subfolder-relative URL suitable
  // for /view?type=input&subfolder=...&filename=...
  static async uploadModel(projectId, filename, dataURL) {
    const res = await api.fetchApi("/pixaroma/api/3d/model_upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        filename,
        data: dataURL,
      }),
    });
    return res.json();
  }
}
