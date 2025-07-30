/**
 * HT Framework middleware
 * This function is called before the page is rendered
 * @since V2
 * @param {Object} page page settings
 * @param {{req: import("express").Request, res: import("express").Response, next: import("express").NextFunction}} middleware request, response and next function
 * @param {Object} config global configuration
 * @returns {Promise<{done: boolean, any}>} whether the request was handled, otherwise return the request context addition of this module
 */
export default async (page, { req, res, next }, config) => {
    // non header part (for specific queries)
    if (req.query?.mode == "normal" || req.query?.mode == "reset") {
        // res.clearCookie("low_bandwidth");
    }
    if (req.query?.mode == "lite" || req.headers?.cookie?.includes("low_bandwidth=true")) {
        // disable all scripts and styles
        console.log(page);
        page.settings.scripts = [];
        page.settings.stylesheets = [];
        page.settings.low_bandwidth = true;
        page.settings.loadbootstrap = false;
        // this causes issues with caching, so we don't use it
        // res.cookie("low_bandwidth", "true", { httpOnly: true, maxAge: undefined });
    }

    // header stuff
    console.log("Headers: " + JSON.stringify(req.headers, null, 4));
    return { done: false };
}