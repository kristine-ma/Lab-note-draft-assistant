chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_SELECTION") {
    sendResponse({ text: getSelectionText() });
    return true;
  }

  if (message?.type === "GET_PAGE_TEXT") {
    sendResponse({ text: getRelevantPageText() });
    return true;
  }

  return false;
});

function getSelectionText() {
  return window.getSelection()?.toString().trim() || "";
}

function getRelevantPageText() {
  const text = document.body?.innerText || "";
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isLikelyNavigation(line))
    .join("\n")
    .slice(0, 18000);
}

function isLikelyNavigation(line) {
  if (line.length < 2) return true;
  if (/^(home|search|print|logout|settings|help|menu)$/i.test(line)) return true;
  return false;
}
