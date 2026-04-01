import { PIXAROMA_LOGO } from "./pixaroma_svg_logo.js";

export const allow_debug = true;

export function createDummyWidget(titleText, subtitleText, instructionText) {
    const imgSrc = PIXAROMA_LOGO;
    const container = document.createElement("div");
    container.style.cssText = `
      display: flex; 
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 20px;
      background-color: #121212;
      border-radius: 8px;
      width: 100%;
      height: 100%;
      color: #ffffff;
      font-family: sans-serif;
      text-align: center;
      box-sizing: border-box;
    `;

    // --- Logo/Icon ---
    const logo = document.createElement("img");
    logo.src = imgSrc || ""; 
    logo.style.cssText = `
      width: 45px;
      height: auto;
      margin-bottom: 10px;
    `;
    container.appendChild(logo);

    // --- Title ---
    const title = document.createElement("div");
    title.innerText = titleText;
    title.style.cssText = `
      font-size: 22px;
      font-weight: 700;
      margin: 0;
      line-height: 1.2;
    `;
    container.appendChild(title);

    // --- Subtitle ---
    const subtitle = document.createElement("div");
    subtitle.innerText = subtitleText;
    subtitle.style.cssText = `
      font-size: 18px;
      font-weight: 700;
      color: #ff6b4a;
      margin: 0;
      line-height: 1.2;
    `;
    container.appendChild(subtitle);

    // --- Instruction Text ---
    const instruction = document.createElement("div");
    instruction.innerText = `Click 'Open ${titleText}' to start`;
    instruction.style.cssText = `
      font-size: 10px;
      color: #555555;
      margin-top: 12px;
    `;
    container.appendChild(instruction);

    return container;
}
