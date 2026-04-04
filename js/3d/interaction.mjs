// ============================================================
// Pixaroma 3D Editor — Tools, camera, keyboard, click, undo
// ============================================================
import { Pixaroma3DEditor, getTHREE } from "./core.mjs";

// ─── Tools & Camera ───────────────────────────────────────

Pixaroma3DEditor.prototype._setToolMode = function(mode) {
    this.toolMode = mode;
    if (this.transformCtrl) this.transformCtrl.setMode({move:"translate",rotate:"rotate",scale:"scale"}[mode]||"translate");
    ["move","rotate","scale"].forEach(m => this.el[`tool_${m}`]?.classList.toggle("active", m===mode));
    const def = this._toolDefs.find(t=>t.id===mode);
    if (this.el.toolInfo && def) this.el.toolInfo.textContent = def.tip;
};

Pixaroma3DEditor.prototype._camView = function(id) {
    const dist = 6;
    if (id==="front") { this.camera.position.set(0,1,dist); this.orbitCtrl.target.set(0,1,0); }
    else if (id==="side") { this.camera.position.set(dist,1,0); this.orbitCtrl.target.set(0,1,0); }
    else if (id==="back") { this.camera.position.set(0,1,-dist); this.orbitCtrl.target.set(0,1,0); }
    else if (id==="top") { this.camera.position.set(0,dist+2,0.01); this.orbitCtrl.target.set(0,0,0); }
    else if (id==="focus" && this.activeObj) {
        const p = this.activeObj.position;
        this.orbitCtrl.target.set(p.x,p.y,p.z);
        this.camera.position.set(p.x+3,p.y+2,p.z+3);
    }
    this.orbitCtrl.update();
};

Pixaroma3DEditor.prototype._setPerspective = function(persp) {
    const THREE = getTHREE();
    if (persp === !this._isOrtho) return; // Already in this mode
    const vp = this.el.viewport, w = vp.clientWidth, h = vp.clientHeight;
    const pos = this.camera.position.clone(), tgt = this.orbitCtrl.target.clone();
    if (persp) {
        this.camera = new THREE.PerspectiveCamera(this._fov, w/h, 0.1, 1000);
        this._isOrtho = false;
    } else {
        this.camera = new THREE.OrthographicCamera(-5*w/h, 5*w/h, 5, -5, 0.1, 1000);
        this._isOrtho = true;
    }
    this.camera.position.copy(pos); this.camera.lookAt(tgt);
    if (this._isOrtho) this.camera.updateProjectionMatrix();
    this.orbitCtrl.object = this.camera; this.orbitCtrl.update();
    this.transformCtrl.camera = this.camera;
    this.el.perspBtn?.classList.toggle("active", !this._isOrtho);
    this.el.isoBtn?.classList.toggle("active", this._isOrtho);
};

// ─── Interaction ──────────────────────────────────────────

Pixaroma3DEditor.prototype._onClick = function(e) {
    const THREE = getTHREE();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, this.camera);
    const hits = ray.intersectObjects(this.objects);
    if (hits.length > 0) this._select(hits[0].object, e.shiftKey);
    else {
        for (const o of this.selectedObjs) o.material.emissive?.setHex(0x000000);
        this.selectedObjs.clear(); this.activeObj = null;
        this.transformCtrl.detach(); this._syncProps(); this._updateLayers();
    }
};

Pixaroma3DEditor.prototype._handleKey = function(e) {
    if (!this.el.overlay?.parentNode) return;
    // Block ALL key events from reaching ComfyUI while overlay is open
    e.stopPropagation();
    e.stopImmediatePropagation();
    // Check if focus is on an input element inside our overlay
    const ae = document.activeElement;
    const tag = ae?.tagName;
    const isTrap = ae?.dataset?.pixaromaTrap;
    // For Ctrl+A: always handle it if our overlay is open (prevent selecting input text)
    const k = e.key, kl = k.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && kl === "a") {
        e.preventDefault();
        // Blur any focused input first
        if ((tag === "INPUT" || tag === "TEXTAREA") && !isTrap) ae.blur();
        this._selectAll();
        return;
    }
    // For other shortcuts, skip if inside input fields (but not our focus trap)
    if ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") && !isTrap) return;
    const handled = ctrl ? ["z","y","d","s"].includes(kl) : ["m","r","s","f","b","t","0","1","2","3","4","delete","backspace","escape"].includes(kl);
    if (handled) e.preventDefault();
    if (ctrl && kl === "z") { this._undo(); return; }
    if (ctrl && kl === "y") { this._redo(); return; }
    if (ctrl && kl === "d") { this._dupSelected(); return; }
    if (ctrl && kl === "s") { this._save(); return; }
    if (kl === "delete" || kl === "backspace") { this._deleteSelected(); return; }
    if (kl === "escape") { if (this.el.helpOverlay?.style.display === "block") this.el.helpOverlay.style.display = "none"; return; }
    if (kl === "m") this._setToolMode("move");
    else if (kl === "r") this._setToolMode("rotate");
    else if (kl === "s") this._setToolMode("scale");
    else if (kl === "f" || k === "1") this._camView("front");
    else if (k === "2") this._camView("side");
    else if (kl === "b" || k === "3") this._camView("back");
    else if (kl === "t" || k === "4") this._camView("top");
    else if (k === "0") this._camView("focus");
};

Pixaroma3DEditor.prototype._selectAll = function() {
    for (const o of this.selectedObjs) o.material.emissive?.setHex(0x000000);
    this.selectedObjs.clear();
    this.objects.forEach(o => { this.selectedObjs.add(o); o.material.emissive?.setHex(0x3a1f00); });
    // Set active to first unlocked object for gizmo
    this.activeObj = this.objects.find(o => !o.userData.locked) || this.objects[0] || null;
    if (this.activeObj) {
        this.activeObj.material.emissive?.setHex(0x4a2800);
        this.transformCtrl.attach(this.activeObj);
    }
    this._updateLayers(); this._syncProps();
    this._setStatus(`Selected all ${this.objects.length} objects`);
};

// ─── Undo ─────────────────────────────────────────────────

Pixaroma3DEditor.prototype._snap = function() {
    return this.objects.map(o=>({id:o.userData.id,name:o.userData.name,type:o.userData.type,colorHex:o.userData.colorHex,locked:o.userData.locked,gp:o.userData.geoParams?{...o.userData.geoParams}:null,pos:o.position.toArray(),rot:[o.rotation.x,o.rotation.y,o.rotation.z],scl:o.scale.toArray(),rough:o.material.roughness,metal:o.material.metalness,opac:o.material.opacity,vis:o.visible}));
};

Pixaroma3DEditor.prototype._pushUndo = function() {
    if(this._isRestoring)return; this._undoStack.push(this._snap()); if(this._undoStack.length>this.MAX_UNDO)this._undoStack.shift(); this._redoStack=[];
};

Pixaroma3DEditor.prototype._undo = function() {
    if(!this._undoStack.length)return; this._redoStack.push(this._snap()); this._applySnap(this._undoStack.pop());
};

Pixaroma3DEditor.prototype._redo = function() {
    if(!this._redoStack.length)return; this._undoStack.push(this._snap()); this._applySnap(this._redoStack.pop());
};

Pixaroma3DEditor.prototype._applySnap = function(state) {
    const THREE = getTHREE();
    this.transformCtrl.detach();
    this.objects.forEach(o=>{this.scene.remove(o);o.geometry.dispose();o.material.dispose();});
    this.objects=[]; this.selectedObjs.clear(); this.activeObj=null;
    state.forEach(d=>{
        const gp = d.gp || this._defaultGeoParams(d.type);
        const g = this._makeGeo(d.type, gp);
        const mat=new THREE.MeshStandardMaterial({color:d.colorHex||"#888",roughness:d.rough??0.85,metalness:d.metal??0,transparent:true,opacity:d.opac??1});
        const m=new THREE.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;
        if(d.pos)m.position.fromArray(d.pos);if(d.rot)m.rotation.set(d.rot[0],d.rot[1],d.rot[2]);if(d.scl)m.scale.fromArray(d.scl);
        m.visible=d.vis!==false;m.userData={id:d.id,name:d.name,type:d.type,colorHex:d.colorHex,locked:d.locked||false,geoParams:gp};
        if(d.id>this._id)this._id=d.id;
        this.scene.add(m);this.objects.push(m);
    });
    if(this.objects.length)this._select(this.objects[0],false);
    this._updateLayers();
};
