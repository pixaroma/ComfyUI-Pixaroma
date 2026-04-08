class AnyType(str):
    def __ne__(self, __value: object) -> bool:
        return False


any_type = AnyType("*")


class FlexibleOptionalInputType(dict):
    def __init__(self, type):
        self.type = type

    def __getitem__(self, key):
        return (self.type,)

    def __contains__(self, key):
        return True


class PixaromaReferenceNode:
    @classmethod
    def INPUT_TYPES(self):
        return {
            "required": {},
            "optional": FlexibleOptionalInputType(any_type),
        }

    CATEGORY = "Pixaroma"

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("output",)
    FUNCTION = "dom_func"
    DESCRIPTION = "Example to create test dom HTML object in nodes"
    OUTPUT_NODE = True

    def dom_func(self, **kwargs):
        counter = 0
        for key, value in kwargs.items():
            if key == "CounterWidget":
                print(key, value)
                counter = str(value["count"]) or "0"
                text = value["text"] or ""
        return (str(text + " " + counter),)


from comfy_api.latest import io

PixaromaData = io.Custom("PIXAROMA_DATA")


class PixaromaVueReferenceNode(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Pixaroma_VueReferenceNode",  # unique, use a prefix!
            display_name="Pixaroma Vue Reference Node",
            category="Pixaroma",
            description="new Pixaroma Vue Reference Node compatible with Nodes 2.0",
            inputs=[
                io.Image.Input("image"),
                io.Int.Input("count", default=1, min=0, max=100),
                io.String.Input("prompt", multiline=True),
                io.Combo.Input("mode", options=["option1", "option2"]),
                io.Mask.Input("mask", optional=True),
                PixaromaData.Input("pixaroma_data", optional=True),
            ],
            outputs=[
                io.Image.Output(display_name="result"),
                PixaromaData.Output(display_name="pixaroma_data"),
            ],
        )

    @classmethod
    def execute(cls, image, count, prompt, mode, mask=None) -> io.NodeOutput:
        result = 1.0 - image  # example: invert
        return io.NodeOutput(result)


NODE_CLASS_MAPPINGS = {
    "PixaromaReferenceNode": PixaromaReferenceNode,
    "Pixaroma_VueReferenceNode": PixaromaVueReferenceNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaReferenceNode": "Reference Node",
    "Pixaroma_VueReferenceNode": "Pixaroma Vue Reference Node",
}
