# ComfyUI-Pixaroma

A creative suite of visual editors for [ComfyUI](https://github.com/comfyanonymous/ComfyUI) - build 3D scenes, paint textures, compose layered images, and compare results directly inside your workflow.

## Nodes

| Node | Description |
|------|-------------|
| **3D Builder Pixaroma** | WebGL 3D scene editor with primitives, materials, lighting, camera controls, and background image support |
| **Image Composer Pixaroma** | Layer-based image compositor with transforms, eraser masks, and AI background removal |
| **Paint Pixaroma** | Full painting studio with brushes, layers, blend modes, smudge, and color tools |
| **Image Crop Pixaroma** | Visual crop editor for precise image cropping with aspect ratio presets |
| **Image Compare Pixaroma** | Interactive image comparison with Left Right, Up Down, Overlay, and Difference modes |
| **Label Pixaroma** | Annotation label for organizing and documenting workflows |
| **Show Text** | Utility node that displays any value (tensors, latents, strings) as readable text |

## Previews

### 3D Builder
![3D Builder Node](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/3D%20Builder%20Pixaroma%20Workflow%20Node%20Preview.png)
![3D Builder UI](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/3D%20Builder%20Pixaroma%20Workflow%20UI%20Preview.png)

### Image Composer
![Image Composer Node](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Image%20Composer%20Pixaroma%20Workflow%20Node%20Preview.png)
![Image Composer UI](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Image%20Composer%20Pixaroma%20Workflow%20UI%20Preview.png)

### Paint
![Paint Node](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Paint%20Pixaroma%20Workflow%20Node%20Preview.png)
![Paint UI](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Paint%20Pixaroma%20Workflow%20UI%20Preview.png)

### Image Crop
![Crop Node](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Crop%20Pixaroma%20Workflow%20Node%20Preview.png)
![Crop UI](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Crop%20Pixaroma%20Workflow%20UI%20Preview.png)

### Image Compare
![Image Compare](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Image%20Compare%20Pixaroma%20Workflow%20Preview.png)

### Labels
![Labels](https://raw.githubusercontent.com/pixaroma/ComfyUI-Pixaroma/main/workflows/Labels%20Pixaroma%20Workflow%20Preview.png)

## Installation

### Recommended: ComfyUI Easy Install
New to ComfyUI? We recommend using the easy installer:
[ComfyUI Easy Install](https://github.com/Tavris1/ComfyUI-Easy-Install)

### Via ComfyUI Manager (Recommended)

### Manual
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/pixaroma/ComfyUI-Pixaroma.git
```

### AI Background Removal (Optional)
The Image Composer includes an AI Remove Background button powered by [rembg](https://github.com/danielgatis/rembg). To enable it:

**Windows Portable ComfyUI:**
1. Open the `python_embeded` folder inside your ComfyUI directory
2. Click the address bar, type `cmd`, press Enter
3. Run: `python.exe -m pip install rembg`

**Standard Python:**
```bash
pip install rembg
```

On first use, the AI model (~170 MB) downloads automatically to `ComfyUI/models/rembg/`. Subsequent removals are near-instant.

## Tutorials

Video tutorials and workflow examples on the Pixaroma YouTube channel:

**https://www.youtube.com/@pixaroma**

> 💡 **Heads up:** I'm not a developer - these nodes were created with AI help. Everything works as intended, but bugs may exist.
>
> 💬 Join the Discord: https://discord.gg/gggpkVgBf3
## License

MIT
