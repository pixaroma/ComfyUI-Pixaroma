import { app } from "../../../scripts/app.js";
import { allow_debug } from "./pixaroma_shared.js";

app.registerExtension({
  name: "Pixaroma.testNode",
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "PixaromaTestNode") {
      return;
    }

    // must set 'OUTPUT_NODE = True' on python side
    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      if (allow_debug) console.log("PixaromaTestNode executed");
    };
  },

  async nodeCreated(node) {
    if (node.comfyClass !== "PixaromaTestNode") {
      return;
    }

    // Set initial node size if needed
    node.size = [200, 230];
    // if(allow_debug) console.log('node',node);

    // Create container div
    const container = document.createElement("div");
    container.className = "counter-widget";
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;     /* Centers items horizontally */
      justify-content: center; /* Centers items vertically */
      gap: 10px;
      padding: 10px;
      background-color: #2a2a2a;
      border-radius: 4px;
      width: 100%;
    `;

    // Create controls
    const label = document.createElement("label");
    label.textContent = "Counter";
    label.style.color = "#fff";

    const controlsDiv = document.createElement("div");
    controlsDiv.style.cssText = `
      display: flex;
      gap: 10px;
      align-items: center;
    `;

    const minusButton = document.createElement("button");
    minusButton.textContent = "-";
    minusButton.style.minWidth = "30px";
    minusButton.className = "comfy-button";

    const counterValue = document.createElement("span");
    counterValue.textContent = "0";
    counterValue.style.color = "#fff";

    const plusButton = document.createElement("button");
    plusButton.textContent = "+";
    plusButton.style.minWidth = "30px";
    plusButton.className = "comfy-button";

    // Add textarea
    const textarea = document.createElement("textarea");
    textarea.className = "comfy-multiline-input";
    textarea.value = "Notes here...";
    textarea.style.width = "100%";
    textarea.style.minHeight = "80px";
    textarea.style.margin = "10px 0";

    // Assemble the widget
    controlsDiv.appendChild(minusButton);
    controlsDiv.appendChild(counterValue);
    controlsDiv.appendChild(plusButton);

    container.appendChild(label);
    container.appendChild(controlsDiv);
    container.appendChild(textarea);

    // Add event handlers
    const updateCounter = (delta) => {
      const newValue = parseInt(counterValue.textContent) + delta;
      counterValue.textContent = newValue.toString();
      widget.value = {
        count: newValue,
        text: textarea.value,
      };
    };

    minusButton.onclick = () => updateCounter(-1);
    plusButton.onclick = () => updateCounter(1);
    textarea.oninput = () => {
      widget.value = {
        count: parseInt(counterValue.textContent),
        text: textarea.value,
      };
    };

    // Create the widget
    const widget = node.addDOMWidget("CounterWidget", "custom", container, {
      getValue: () => ({
        count: parseInt(counterValue.textContent),
        text: textarea.value,
      }),
      setValue: (v) => {
        if (v && typeof v === "object") {
          counterValue.textContent = v.count?.toString() || "0";
          textarea.value = v.text || "";
        }
      },
      getMinHeight: () => 200,
      getMaxHeight: () => 400,
      margin: 5,
      onDraw: (ctx) => {},
    });

    // Apply margin directly to the container
    container.style.marginTop = "0px";

    // Clean up on node removal
    const origOnRemoved = node.onRemoved;
    node.onRemoved = function () {
      origOnRemoved?.apply(this, arguments);
      if (allow_debug) console.log("Cleaning up widget");
    };

    // Force canvas update
    node.setDirtyCanvas(true, true);
  },
});
