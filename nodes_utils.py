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


class PixaromaTestNode:
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


NODE_CLASS_MAPPINGS = {
    "PixaromaTestNode": PixaromaTestNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PixaromaTestNode": "Test Node",
}
