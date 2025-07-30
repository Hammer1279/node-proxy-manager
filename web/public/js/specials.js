document.addEventListener('DOMContentLoaded', function () {
    const textarea = document.getElementById('host');
    if (!textarea) return;

    const specialValues = ['default', 'invalid.host', 'external-direct-ip'];
    const firstRow = document.querySelector('div.row');
    if (!firstRow) return;

    let messageElem = null;

    function checkSpecialValues() {
        const values = textarea.value.split(',').map(v => v.trim());
        const hasSpecial = values.some(v => specialValues.includes(v));
        if (hasSpecial) {
            if (!messageElem) {
                // messageElem = document.createElement('p');
                // messageElem.className = 'text-info';
                messageElem = document.createElement('div');
                messageElem.className = 'alert alert-info';
                messageElem.role = 'alert';
                messageElem.textContent = 'This is a special rule that uses internal fallback routes, double check that this is intended.';
                firstRow.parentNode.insertBefore(messageElem, firstRow);
            }
        } else {
            if (messageElem) {
                messageElem.remove();
                messageElem = null;
            }
        }
    }

    textarea.addEventListener('input', checkSpecialValues);
    checkSpecialValues(); // Initial check
});