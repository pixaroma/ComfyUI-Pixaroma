import os
import random
import numpy as np
from PIL import Image
import folder_paths


class PixaromaCompare:
    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.prefix_append = "_pixcmp_" + ''.join(
            random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5)
        )
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "image1": ("IMAGE",),
                "image2": ("IMAGE",),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "compare_images"
    OUTPUT_NODE = True
    CATEGORY = "Pixaroma"

    def compare_images(self, image1, image2):
        results = []
        prefix = "pixaroma_compare" + self.prefix_append
        full_output_folder, filename, counter, subfolder, _ = (
            folder_paths.get_save_image_path(
                prefix, self.output_dir,
                image1[0].shape[1], image1[0].shape[0],
            )
        )

        for tensor in [image1, image2]:
            i = 255.0 * tensor[0].cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
            file = f"{filename}_{counter:05}_.png"
            img.save(
                os.path.join(full_output_folder, file),
                compress_level=self.compress_level,
            )
            results.append({
                "filename": file,
                "subfolder": subfolder,
                "type": self.type,
            })
            counter += 1

        return {"ui": {"images": results}}


NODE_CLASS_MAPPINGS = {
    "PixaromaCompare": PixaromaCompare,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaCompare": "Image Compare Pixaroma",
}
