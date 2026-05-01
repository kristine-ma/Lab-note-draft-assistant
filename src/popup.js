const elements = {
  addSelection: document.querySelector("#add-selection"),
  alert: document.querySelector("#alert"),
  apiKey: document.querySelector("#api-key"),
  captureScreenshot: document.querySelector("#capture-screenshot"),
  clear: document.querySelector("#clear"),
  copyNote: document.querySelector("#copy-note"),
  draftNote: document.querySelector("#draft-note"),
  extractPage: document.querySelector("#extract-page"),
  extractSelection: document.querySelector("#extract-selection"),
  generate: document.querySelector("#generate"),
  imageFile: document.querySelector("#image-file"),
  imagePanel: document.querySelector("#image-panel"),
  imageStatus: document.querySelector("#image-status"),
  labText: document.querySelector("#lab-text"),
  model: document.querySelector("#model"),
  patientName: document.querySelector("#patient-name"),
  proxyUrl: document.querySelector("#proxy-url"),
  removeImage: document.querySelector("#remove-image"),
  saveSettings: document.querySelector("#save-settings"),
  settings: document.querySelector("#settings"),
  settingsToggle: document.querySelector("#settings-toggle"),
  screenshotPreview: document.querySelector("#screenshot-preview"),
  template: document.querySelector("#template"),
  sourceStatus: document.querySelector("#source-status"),
  tone: document.querySelector("#tone"),
  uploadImage: document.querySelector("#upload-image")
};

document.addEventListener("DOMContentLoaded", restoreSettings);
elements.settingsToggle.addEventListener("click", toggleSettings);
elements.saveSettings.addEventListener("click", saveSettings);
elements.extractSelection.addEventListener("click", () => extractText("GET_SELECTION", "replace"));
elements.addSelection.addEventListener("click", () => extractText("GET_SELECTION", "append"));
elements.extractPage.addEventListener("click", () => extractText("GET_PAGE_TEXT", "replace"));
elements.captureScreenshot.addEventListener("click", captureScreenshot);
elements.uploadImage.addEventListener("click", () => elements.imageFile.click());
elements.imageFile.addEventListener("change", uploadImageFile);
elements.removeImage.addEventListener("click", removeScreenshot);
elements.generate.addEventListener("click", generateDraft);
elements.copyNote.addEventListener("click", copyDraft);
elements.clear.addEventListener("click", clearText);
elements.labText.addEventListener("input", saveWorkspaceState);
elements.draftNote.addEventListener("input", saveWorkspaceState);
elements.patientName.addEventListener("input", saveWorkspaceState);
elements.template.addEventListener("change", saveWorkspaceState);
elements.tone.addEventListener("change", saveWorkspaceState);

async function restoreSettings() {
  const settings = await chrome.storage.local.get([
    "apiKey",
    "draftNote",
    "model",
    "patientName",
    "proxyUrl",
    "screenshotDataUrl",
    "sourceText",
    "template",
    "tone"
  ]);
  elements.apiKey.value = settings.apiKey || "";
  elements.draftNote.value = settings.draftNote || "";
  elements.labText.value = settings.sourceText || "";
  elements.model.value = settings.model || "gpt-4.1";
  elements.patientName.value = settings.patientName || "";
  elements.proxyUrl.value = settings.proxyUrl || "";
  setScreenshotPreview(settings.screenshotDataUrl || "");
  elements.template.value = settings.template || "chart_labs_assessment_plan";
  elements.tone.value = settings.tone || "concise";
}

function toggleSettings() {
  elements.settings.classList.toggle("hidden");
}

async function saveSettings() {
  await chrome.storage.local.set({
    apiKey: elements.apiKey.value.trim(),
    model: elements.model.value.trim() || "gpt-4.1",
    proxyUrl: elements.proxyUrl.value.trim()
  });
  showAlert("Settings saved.");
}

async function extractText(type, mode) {
  setBusy(true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const text = await getTextFromActiveTab(tab, type);

    if (!text) {
      showAlert(type === "GET_SELECTION" ? "No selected text found." : "No page text found.", true);
      return;
    }

    if (mode === "append") {
      appendSourceText(text);
      await saveWorkspaceState();
      elements.sourceStatus.textContent = "Added selected text from the current page.";
      showAlert("Selection added.");
      return;
    }

    elements.labText.value = text;
    await saveWorkspaceState();
    elements.sourceStatus.textContent = type === "GET_SELECTION"
      ? "Using selected text from the current page."
      : "Using visible text from the current page.";
    showAlert("Source text extracted.");
  } catch (error) {
    showAlert(error.message || "Could not extract text from this page.", true);
  } finally {
    setBusy(false);
  }
}

function appendSourceText(text) {
  const existing = elements.labText.value.trim();
  const nextIndex = countSelections(existing) + 1;
  const section = `Selection ${nextIndex}:\n${text.trim()}`;
  elements.labText.value = existing ? `${existing}\n\n${section}` : section;
}

async function saveWorkspaceState() {
  await chrome.storage.local.set({
    draftNote: elements.draftNote.value,
    patientName: elements.patientName.value,
    screenshotDataUrl: elements.screenshotPreview.dataset.imageUrl || "",
    sourceText: elements.labText.value,
    template: elements.template.value,
    tone: elements.tone.value
  });
}

function countSelections(text) {
  return text.match(/^Selection \d+:/gm)?.length || 0;
}

async function getTextFromActiveTab(tab, type) {
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type });
    return response?.text?.trim() || "";
  } catch (error) {
    if (!isMissingContentScriptError(error)) {
      throw error;
    }

    return getTextByInjection(tab.id, type);
  }
}

async function getTextByInjection(tabId, type) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (messageType) => {
        const isLikelyNavigation = (line) => {
          if (line.length < 2) return true;
          return /^(home|search|print|logout|settings|help|menu)$/i.test(line);
        };

        if (messageType === "GET_SELECTION") {
          return window.getSelection()?.toString().trim() || "";
        }

        const text = document.body?.innerText || "";
        return text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => !isLikelyNavigation(line))
          .join("\n")
          .slice(0, 18000);
      },
      args: [type]
    });

    return result?.result?.trim() || "";
  } catch (error) {
    throw new Error(buildPageAccessError(error));
  }
}

function isMissingContentScriptError(error) {
  return error?.message?.includes("Receiving end does not exist");
}

function buildPageAccessError(error) {
  const reason = error?.message ? ` Chrome said: ${error.message}` : "";
  return [
    "Chrome could not read this page.",
    "Make sure the tab is a loaded http:// or https:// page.",
    "If you are using http://localhost:8787/test, restart the proxy first and confirm Terminal says it is listening.",
    "Avoid chrome://, data:, browser error pages, PDFs, and file:// pages unless file access is enabled.",
    reason
  ].join(" ");
}

async function captureScreenshot() {
  setBusy(true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.windowId) {
      throw new Error("No active browser tab found.");
    }

    const rawDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const dataUrl = await compressImageDataUrl(rawDataUrl);
    setScreenshotPreview(dataUrl);
    await saveWorkspaceState();
    showAlert("Screenshot captured for analysis.");
  } catch (error) {
    showAlert(error.message || "Could not capture a screenshot from this tab.", true);
  } finally {
    setBusy(false);
  }
}

async function uploadImageFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showAlert("Choose an image file, such as PNG or JPEG.", true);
    return;
  }

  try {
    const rawDataUrl = await readFileAsDataUrl(file);
    const dataUrl = await compressImageDataUrl(rawDataUrl);
    setScreenshotPreview(dataUrl);
    await saveWorkspaceState();
    showAlert("Image added for analysis.");
  } catch (error) {
    showAlert(error.message || "Could not read the image file.", true);
  } finally {
    elements.imageFile.value = "";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => reject(new Error("Could not prepare the image for analysis."));
    image.src = dataUrl;
  });
}

async function removeScreenshot() {
  setScreenshotPreview("");
  await saveWorkspaceState();
  showAlert("Screenshot removed.");
}

function setScreenshotPreview(dataUrl) {
  elements.screenshotPreview.dataset.imageUrl = dataUrl;
  elements.screenshotPreview.src = dataUrl || "";
  elements.imagePanel.classList.toggle("hidden", !dataUrl);
  elements.imageStatus.textContent = dataUrl
    ? "Screenshot/image selected for AI analysis."
    : "No screenshot selected.";
}

async function generateDraft() {
  const labText = elements.labText.value.trim();
  const screenshotDataUrl = elements.screenshotPreview.dataset.imageUrl || "";
  if (!labText && !screenshotDataUrl) {
    showAlert("Paste/extract text or add a screenshot first.", true);
    return;
  }

  setBusy(true);
  elements.draftNote.value = "";
  showAlert("Generating draft note...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_LAB_NOTE",
      payload: {
        labText,
        patientName: elements.patientName.value.trim(),
        screenshotDataUrl,
        template: elements.template.value,
        tone: elements.tone.value
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not generate a draft note.");
    }

    elements.draftNote.value = response.note;
    await saveWorkspaceState();
    showAlert("Draft generated. Review before using in the chart.");
  } catch (error) {
    showAlert(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function copyDraft() {
  if (!elements.draftNote.value.trim()) {
    showAlert("No draft note to copy.", true);
    return;
  }

  await navigator.clipboard.writeText(elements.draftNote.value);
  showAlert("Draft note copied.");
}

async function clearText() {
  elements.labText.value = "";
  elements.draftNote.value = "";
  elements.patientName.value = "";
  setScreenshotPreview("");
  await chrome.storage.local.remove(["draftNote", "patientName", "screenshotDataUrl", "sourceText"]);
  elements.sourceStatus.textContent = "Ready to extract selected text or page labs.";
  showAlert("Cleared.");
}

function showAlert(message, isError = false) {
  elements.alert.textContent = message;
  elements.alert.classList.toggle("error", isError);
  elements.alert.classList.remove("hidden");
}

function setBusy(isBusy) {
  [
    elements.extractPage,
    elements.extractSelection,
    elements.generate,
    elements.addSelection,
    elements.captureScreenshot,
    elements.copyNote,
    elements.clear,
    elements.removeImage,
    elements.saveSettings
  ].forEach((button) => {
    button.disabled = isBusy;
  });
}
