// Listens for the command to toggle the dialog
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-dialog") {
    // Send a message to the content script in the active tab
    chrome.tabs.sendMessage(tab.id, { action: "toggle-dialog" });
  }
});
