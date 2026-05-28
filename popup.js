document.addEventListener('DOMContentLoaded', () => {
    const openSettingsBtn = document.getElementById('open-settings');

    const openOptions = () => {
        chrome.runtime.openOptionsPage(() => {
            if (chrome.runtime.lastError) {
                console.error('Failed to open options page:', chrome.runtime.lastError);
            } else {
                window.close();
            }
        });
    };

    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', openOptions);
    }

    // Auto-open settings page
    openOptions();
});
