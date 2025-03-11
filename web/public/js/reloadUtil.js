function applyConfig(e) {
    e.preventDefault();
    fetch('/config/apply', {
        method: 'POST'
    })
    .then(response => {
        if (!response.ok) {
            return response.text().then(text => {
                throw new Error('Network response was not ok!\n' + text);
            });
        }
        alert('Configuration applied successfully');
    })
    .catch(error => {
        console.error(error);
        alert('Error applying configuration!\n' + error);
    });
}

window.applyConfig = applyConfig;