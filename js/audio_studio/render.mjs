// js/audio_studio/render.mjs
import { AudioStudioEditor } from "./core.mjs";
import {
  VERTEX_SHADER, MOTION_SHADERS, OVERLAY_SHADER, compileProgram,
} from "./shaders.mjs";

const QUAD_VERTS = new Float32Array([
  -1, -1,  1, -1, -1,  1,
  -1,  1,  1, -1,  1,  1,
]);

AudioStudioEditor.prototype._initRenderer = function () {
  if (this._gl) return;
  const canvas = document.createElement("canvas");
  canvas.style.maxWidth = "100%";
  canvas.style.maxHeight = "100%";
  this.canvasHost.textContent = "";
  this.canvasHost.appendChild(canvas);
  this.canvas = canvas;

  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false });
  if (!gl) {
    this.canvasHost.textContent = "WebGL2 unavailable — Audio Pulse requires WebGL2. Use the basic Audio React node instead.";
    return;
  }
  // Required for R32F / RGBA32F texture filtering (renderable). Audio
  // textures use NEAREST so we don't actually need linear-float; still
  // good to enable defensively for future.
  gl.getExtension("EXT_color_buffer_float");

  this._gl = gl;

  // Quad VBO + VAO
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
  this._quadVAO = vao;
  this._quadVBO = vbo;

  // Compile motion programs lazily — first use of a mode compiles.
  this._motionPrograms = {};
  this._overlayProgram = compileProgram(gl, VERTEX_SHADER, OVERLAY_SHADER, "overlay");
  this._wireQuadAttrib(this._overlayProgram);

  // Image texture — populated on source load (Milestone H)
  this._imageTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([128, 128, 128, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Audio textures — placeholder zero arrays of length 16 until F lands
  this._envTex = gl.createTexture();
  this._onsetTex = gl.createTexture();
  this._uploadAudioTexture(this._envTex, new Float32Array(16 * 4));    // 16 frames × 4 bands
  this._uploadAudioTexture(this._onsetTex, new Float32Array(16 * 4));
  this._totalFrames = 16;

  // Intermediate framebuffer + texture (resized in _resizeRenderTargets)
  this._fbo = gl.createFramebuffer();
  this._intermediateTex = gl.createTexture();

  this._resizeRenderTargets(512, 512);

  // Default canvas size — actual size set during _render based on canvasHost dims
  this._canvasW = 512; this._canvasH = 512;
};

AudioStudioEditor.prototype._wireQuadAttrib = function (program) {
  const gl = this._gl;
  gl.useProgram(program);
  const loc = gl.getAttribLocation(program, "a_position");
  if (loc >= 0) {
    gl.bindVertexArray(this._quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadVBO);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }
};

AudioStudioEditor.prototype._uploadAudioTexture = function (tex, rgbaArr) {
  const gl = this._gl;
  const len = rgbaArr.length / 4;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, len, 1, 0, gl.RGBA, gl.FLOAT, rgbaArr);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};

AudioStudioEditor.prototype._resizeRenderTargets = function (w, h) {
  const gl = this._gl;
  gl.bindTexture(gl.TEXTURE_2D, this._intermediateTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._intermediateTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

AudioStudioEditor.prototype._setImage = function (imageEl) {
  // imageEl is an HTMLImageElement or HTMLCanvasElement, fully loaded.
  const gl = this._gl;

  // Restore canvas to the DOM if a previous _showCanvasMessage replaced
  // canvasHost.textContent with a status string (which removes ALL
  // children, including our canvas). Without this, a fresh inline image
  // pick would render to an orphaned canvas — invisible until the editor
  // is re-opened from saved state.
  if (this.canvas && !this.canvas.isConnected) {
    this.canvasHost.textContent = "";
    this.canvasHost.appendChild(this.canvas);
  }

  gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageEl);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  this._imageW = imageEl.naturalWidth || imageEl.width;
  this._imageH = imageEl.naturalHeight || imageEl.height;
  this._render();
};

AudioStudioEditor.prototype._setAudioTextures = function (envRgbaArr, onsetRgbaArr, totalFrames) {
  this._uploadAudioTexture(this._envTex, envRgbaArr);
  this._uploadAudioTexture(this._onsetTex, onsetRgbaArr);
  this._totalFrames = totalFrames;
  this._render();
};

AudioStudioEditor.prototype._getMotionProgram = function (mode) {
  const gl = this._gl;
  if (this._motionPrograms[mode]) return this._motionPrograms[mode];
  const src = MOTION_SHADERS[mode];
  if (!src) {
    console.warn(`[Pixaroma] Audio Pulse: motion mode ${mode} has no shader yet — using scale_pulse fallback`);
    return this._getMotionProgram("scale_pulse");
  }
  const prog = compileProgram(gl, VERTEX_SHADER, src, `motion_${mode}`);
  this._wireQuadAttrib(prog);
  this._motionPrograms[mode] = prog;
  return prog;
};

AudioStudioEditor.prototype._currentFrameIndex = function () {
  return Math.min(Math.max(0, this._currentFrame || 0), Math.max(0, this._totalFrames - 1));
};

AudioStudioEditor.prototype._audioBandIndex = function () {
  return ({ full: 0, bass: 1, mids: 2, treble: 3 })[this.cfg.audio_band] ?? 0;
};

AudioStudioEditor.prototype._render = function () {
  if (!this._gl) return;
  const gl = this._gl;

  // Resize backing buffer to canvas host size, preserving aspect.
  const hostRect = this.canvasHost.getBoundingClientRect();
  const maxW = Math.max(64, hostRect.width  | 0);
  const maxH = Math.max(64, hostRect.height | 0);
  let outW, outH;
  if (this._imageW && this._imageH) {
    const ar = this._imageW / this._imageH;
    if (maxW / maxH > ar) { outH = maxH; outW = Math.round(maxH * ar); }
    else                  { outW = maxW; outH = Math.round(maxW / ar); }
  } else {
    outW = maxW; outH = maxH;
  }
  // Cap at 1024 for perf
  if (outW > 1024) { outH = Math.round(outH * (1024 / outW)); outW = 1024; }
  if (outH > 1024) { outW = Math.round(outW * (1024 / outH)); outH = 1024; }
  if (this._canvasW !== outW || this._canvasH !== outH) {
    this.canvas.width = outW;
    this.canvas.height = outH;
    this._canvasW = outW;
    this._canvasH = outH;
    this._resizeRenderTargets(outW, outH);
  }

  const fps = this.cfg.fps || 24;
  const frameIdx = this._currentFrameIndex();
  const t = frameIdx / fps;
  const aspect = outW / outH;

  // -------- Motion pass — render to intermediate FBO --------
  const motionProg = this._getMotionProgram(this.cfg.motion_mode);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
  gl.viewport(0, 0, outW, outH);
  gl.useProgram(motionProg);
  gl.bindVertexArray(this._quadVAO);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this._imageTex);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_image"), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, this._envTex);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_envelope"), 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, this._onsetTex);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_onset"), 2);

  gl.uniform1i(gl.getUniformLocation(motionProg, "u_total_frames"), this._totalFrames);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_frame_index"), frameIdx);
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_audio_band_idx"), this._audioBandIndex());
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_intensity"), this.cfg.intensity);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_motion_speed"), this.cfg.motion_speed);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_motion_direction"),
               (this.cfg.motion_direction ?? 1.0) >= 0 ? 1.0 : -1.0);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_t"), t);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_aspect"), aspect);
  gl.uniform2f(gl.getUniformLocation(motionProg, "u_resolution"), outW, outH);
  // Per-mode uniforms — only the active motion shader actually reads them.
  // Unused-uniform locations come back as null and uniform calls no-op.
  const axisVal = this.cfg.shake_axis === "x" ? 1
               : this.cfg.shake_axis === "y" ? 2 : 0;
  gl.uniform1i(gl.getUniformLocation(motionProg, "u_shake_axis"), axisVal);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_ripple_density"),
               this.cfg.ripple_density ?? 1.0);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_slit_density"),
               this.cfg.slit_density ?? 1.0);
  gl.uniform1f(gl.getUniformLocation(motionProg, "u_glitch_bands"),
               this.cfg.glitch_bands ?? 30);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // -------- Overlay pass — render intermediate to screen --------
  const ovProg = this._overlayProgram;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, outW, outH);
  gl.useProgram(ovProg);
  gl.bindVertexArray(this._quadVAO);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this._intermediateTex);
  gl.uniform1i(gl.getUniformLocation(ovProg, "u_intermediate"), 0);
  // Same audio bindings (in case overlays read them — they do, in E10)
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, this._envTex);
  gl.uniform1i(gl.getUniformLocation(ovProg, "u_envelope"), 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, this._onsetTex);
  gl.uniform1i(gl.getUniformLocation(ovProg, "u_onset"), 2);

  gl.uniform1i(gl.getUniformLocation(ovProg, "u_total_frames"), this._totalFrames);
  gl.uniform1i(gl.getUniformLocation(ovProg, "u_frame_index"), frameIdx);
  gl.uniform1i(gl.getUniformLocation(ovProg, "u_audio_band_idx"), this._audioBandIndex());
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_intensity"), this.cfg.intensity);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_motion_speed"), this.cfg.motion_speed);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_motion_direction"),
               (this.cfg.motion_direction ?? 1.0) >= 0 ? 1.0 : -1.0);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_t"), t);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_aspect"), aspect);
  gl.uniform2f(gl.getUniformLocation(ovProg, "u_resolution"), outW, outH);

  gl.uniform1f(gl.getUniformLocation(ovProg, "u_glitch_strength"), this.cfg.glitch_strength);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_bloom_strength"), this.cfg.bloom_strength);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_vignette_strength"), this.cfg.vignette_strength);
  gl.uniform1f(gl.getUniformLocation(ovProg, "u_hue_shift_strength"), this.cfg.hue_shift_strength);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
};

AudioStudioEditor.prototype._destroyRenderer = function () {
  if (!this._gl) return;
  const gl = this._gl;
  for (const prog of Object.values(this._motionPrograms)) gl.deleteProgram(prog);
  if (this._overlayProgram) gl.deleteProgram(this._overlayProgram);
  if (this._imageTex) gl.deleteTexture(this._imageTex);
  if (this._envTex) gl.deleteTexture(this._envTex);
  if (this._onsetTex) gl.deleteTexture(this._onsetTex);
  if (this._intermediateTex) gl.deleteTexture(this._intermediateTex);
  if (this._fbo) gl.deleteFramebuffer(this._fbo);
  if (this._quadVAO) gl.deleteVertexArray(this._quadVAO);
  if (this._quadVBO) gl.deleteBuffer(this._quadVBO);
  // forceContextLoss to be polite
  const ext = gl.getExtension("WEBGL_lose_context");
  if (ext) try { ext.loseContext(); } catch {}
  this._gl = null;
};
