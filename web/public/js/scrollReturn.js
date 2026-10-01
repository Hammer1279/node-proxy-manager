// NOTE: this should be replaced with ajax at some point in time
// TODO: consider to add this to the framework itself as a optional module

const scrollKey = "scroll_pos_" + (window.location.pathname || "home").replace(/\//g, "");

window.addEventListener('DOMContentLoaded', () => {
    const savedPos = sessionStorage.getItem(scrollKey);
    if (savedPos) {
        window.scrollTo({
            top: parseInt(savedPos, 10),
            behavior: 'instant'
        });
    }
});

let scrollTimeout;
window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        const currentPos = window.scrollY;
        if (currentPos > 0) {
            sessionStorage.setItem(scrollKey, currentPos);
        } else {
            sessionStorage.removeItem(scrollKey); // remove when top is reached
        }
    }, 100); // 100ms delay debounce
});