import { app } from "/scripts/app.js";
import { allow_debug } from "../shared/index.js";

app.registerExtension({
  name: "Pixaroma.referenceNode",

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaReferenceNode") {
      return;
    }
    // init size
    node.size = [200, 230];

    // Get all elements from the helper function
    const elements = create_widget_elements();

    // Create the widget using the container from elements
    let widget = node.addDOMWidget(
      "CounterWidget",
      "custom",
      elements.container,
      {
        getValue: () => ({
          count: parseInt(elements.counterValue.textContent),
          text: elements.textarea.value,
        }),
        setValue: (v) => {
          if (v && typeof v === "object") {
            elements.counterValue.textContent = v.count?.toString() || "0";
            elements.textarea.value = v.text || "";
          }
        },
        getMinHeight: () => 200,
        getMaxHeight: () => 400,
        margin: 5,
      },
    );

    // Link event handlers to the widget after it's created
    elements.updateCallback = () => {
      widget.value = {
        count: parseInt(elements.counterValue.textContent),
        text: elements.textarea.value,
      };
    };

    // cleanup when node is removed
    node.onRemoved = () => {
      widget = null;
      if (allow_debug) console.log("PixaromaReferenceNode removed");
    };

    // show widget after 100ms avoid widget flickering
    setTimeout(() => {
      elements.container.style.display = "flex";
      node.setDirtyCanvas(true, true);
    }, 100);
  },
});

function create_widget_elements() {
  const container = document.createElement("div");
  container.style.cssText = `
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 5px;
      background-color: #2a2a2a;
      border-radius: 4px;
      width: 100%;
    `;

  const buttons_style = `
    min-width: 40px;
  `;

  const counterValue = document.createElement("span");
  counterValue.textContent = "0";

  const textarea = document.createElement("textarea");
  textarea.value = "Notes here...";
  textarea.style.cssText = `
    width: 100%;
    height: 100px;
    resize: none;
  `;

  const minusButton = document.createElement("button");
  minusButton.textContent = "-";
  minusButton.style.cssText = buttons_style;

  const plusButton = document.createElement("button");
  plusButton.textContent = "+";
  plusButton.style.cssText = buttons_style;

  const controlsDiv = document.createElement("div");
  controlsDiv.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 5px;
    background-color: #2a2a2a;
    border-radius: 4px;
    width: 100%;
  `;

  controlsDiv.appendChild(minusButton);
  controlsDiv.appendChild(counterValue);
  controlsDiv.appendChild(plusButton);

  container.appendChild(controlsDiv);
  container.appendChild(textarea);

  // Helper object to return multiple references
  const refs = { container, counterValue, textarea, updateCallback: null };

  minusButton.onclick = () => {
    refs.counterValue.textContent = (
      parseInt(refs.counterValue.textContent) - 1
    ).toString();
    if (refs.updateCallback) refs.updateCallback();
  };

  plusButton.onclick = () => {
    refs.counterValue.textContent = (
      parseInt(refs.counterValue.textContent) + 1
    ).toString();
    if (refs.updateCallback) refs.updateCallback();
  };

  textarea.oninput = () => {
    if (refs.updateCallback) refs.updateCallback();
  };

  return refs;
}
