const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static HTML files
app.use(express.static(__dirname));

const BASE_URL = 'https://animesalt.top';

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
};

const mainPageCategories = [
    { path: "category/status/ongoing", name: "On-Air Shows" },
    { path: "category/type/anime/?type=series", name: "New Anime Arrivals" },
    { path: "category/type/cartoon/?type=series", name: "Just In: Cartoon Series" },
    { path: "category/type/anime/?type=movies", name: "Latest Anime Movies" },
    { path: "category/type/cartoon/?type=movies", name: "Fresh Cartoon Films" },
    { path: "category/network/crunchyroll", name: "Crunchyroll" },
    { path: "category/network/netflix", name: "Netflix" },
    { path: "category/network/prime-video", name: "Prime Video" }
];

function parseArticles($) {
    return $('article').map((i, el) => {
        const titleElement = $(el).find('header h2');
        const linkElement = $(el).find('a');
        const imgElement = $(el).find('img');

        const title = titleElement.length ? titleElement.text().trim() : "Unknown Title";
        const link = linkElement.length ? linkElement.attr('href') : null;
        const poster = imgElement.attr('data-src') || imgElement.attr('src') || "";

        if (!link) return null;
        
        // Extract ID from link for routing
        const urlParts = link.split('/').filter(Boolean);
        const id = urlParts[urlParts.length - 1];
        
        return { 
            title, 
            link, 
            poster,
            id,
            type: link.includes('/series/') ? 'series' : 'movie'
        };
    }).get().filter(x => x !== null);
}

// --- Home Page Endpoint ---
app.get('/api/home', async (req, res) => {
    try {
        const homeData = await Promise.all(mainPageCategories.map(async (cat) => {
            try {
                let url = `${BASE_URL}/${cat.path}`;
                if (cat.path.includes('type=')) {
                    const parts = cat.path.split('/?type=');
                    url = `${BASE_URL}/${parts[0]}/page/1/?type=${parts[1]}`;
                }

                const response = await axios.get(url, { headers: BASE_HEADERS, timeout: 5000 });
                const $ = cheerio.load(response.data);
                return {
                    sectionName: cat.name,
                    items: parseArticles($)
                };
            } catch (innerErr) {
                return { sectionName: cat.name, items: [], error: "Section load failed" };
            }
        }));
        res.json(homeData);
    } catch (err) {
        res.status(500).json({ error: "Major failure: " + err.message });
    }
});

// --- Search Endpoint ---
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        const page = req.query.page || 1;
        const formData = new URLSearchParams({
            "action": "torofilm_infinite_scroll",
            "page": page.toString(),
            "per_page": "12",
            "query_type": "search",
            "query_args[s]": query
        });

        const { data: response } = await axios.post(`${BASE_URL}/wp-admin/admin-ajax.php`, formData.toString(), {
            headers: { 
                ...BASE_HEADERS, 
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        if (!response.success || !response.data || !response.data.content) {
            return res.json([]);
        }

        const $ = cheerio.load(response.data.content);
        res.json(parseArticles($));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Details Endpoint (for movie/series info) ---
app.get('/api/details', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ error: "Missing URL" });

        const { data: pageHtml } = await axios.get(url, { headers: BASE_HEADERS });
        const $ = cheerio.load(pageHtml);

        const title = $('h1').text().trim();
        const poster = $('.bgft img').attr('data-src') || $('.bgft img').attr('src') || '';
        const desc = $('#overview-text p').text().trim();
        
        // Correctly find Genres and Year as per Kotlin logic
        const genre = $("h4:contains('Genres')").next().find('a').map((i, el) => $(el).text()).get().join(', ');
        const year = $("div").filter((i, el) => $(el).text().trim().match(/^\d{4}$/)).first().text().trim();
        
        const episodes = [];
        const seasonButtons = $('div.season-buttons a'); // Matching Animesalt.kt

        if (seasonButtons.length > 0) {
            // It's a series
            for (let i = 0; i < seasonButtons.length; i++) {
                const btn = $(seasonButtons[i]);
                const dataSeason = btn.attr('data-season');
                const postId = btn.attr('data-post');

                // Perform the AJAX call for episodes
                const formData = new URLSearchParams({
                    "action": "action_select_season",
                    "season": dataSeason,
                    "post": postId
                });

                const { data: seasonRes } = await axios.post(`${BASE_URL}/wp-admin/admin-ajax.php`, formData.toString(), {
                    headers: { ...BASE_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }
                });

                // Parse the AJAX response
                const s$ = cheerio.load(seasonRes.data || seasonRes);
                s$('li article').each((index, ep) => {
                    const epLink = s$(ep).find('a').attr('href');
                    episodes.push({
                        id: epLink.split('/').filter(Boolean).pop(),
                        link: epLink,
                        title: s$(ep).find('h2.entry-title').text().trim() || `Episode ${index + 1}`,
                        image: s$(ep).find('div.post-thumbnail img').attr('src') || poster,
                        s: `Season ${dataSeason}`,
                        ep: `Episode ${index + 1}`
                    });
                });
            }
        }

        const id = url.split('/').filter(Boolean).pop();

        res.json({
            id,
            title,
            poster,
            desc,
            genre,
            year,
            episodes: episodes.length > 0 ? episodes : null,
            type: episodes.length > 0 ? 'series' : 'movie'
        });
    } catch (err) {
        console.error("Details Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Image Proxy Endpoint ---
app.get('/api/image', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ error: "Missing URL" });

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: BASE_HEADERS
        });

        res.set('Content-Type', response.headers['content-type']);
        res.send(response.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Video Extraction Endpoint ---
app.get('/api/video', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ error: "Missing URL" });

        const { data: pageHtml } = await axios.get(url, { headers: BASE_HEADERS });
        const $ = cheerio.load(pageHtml);
        
        const iframeSrc = $('#options-0 iframe').attr('data-src') || $('iframe[src*="as-cdn"]').attr('src');
        if (!iframeSrc) throw new Error("Video player iframe not found");

        const urlObj = new URL(iframeSrc);
        const videoId = urlObj.pathname.split('/').pop();
        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

        const apiUrl = `${baseUrl}/player/index.php?data=${videoId}&do=getVideo`;
        
        const response = await axios.post(apiUrl, 
            new URLSearchParams({ 'hash': videoId, 'r': 'https://animesalt.top' }).toString(), 
            {
                headers: {
                    ...BASE_HEADERS,
                    'Referer': iframeSrc,
                    'x-requested-with': 'XMLHttpRequest',
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        if (response.data && response.data.videoSource) {
            return res.json({
                url: response.data.videoSource,
                type: "hls",
                headers: {
                    "Referer": baseUrl,
                    "User-Agent": BASE_HEADERS['User-Agent']
                }
            });
        } else {
            throw new Error("No video source returned from API");
        }
    } catch (err) {
        console.error("Video Extraction Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- Extraction Endpoint (legacy support) ---
app.get('/api/video', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ error: "Missing URL" });

        const { data: pageHtml } = await axios.get(url, { headers: BASE_HEADERS });
        const $ = cheerio.load(pageHtml);
        
        const iframeSrc = $('#options-0 iframe').attr('data-src') || $('iframe[src*="as-cdn"]').attr('src');
        if (!iframeSrc) throw new Error("Video player iframe not found");

        const urlObj = new URL(iframeSrc);
        const videoId = urlObj.pathname.split('/').pop();
        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
        const apiUrl = `${baseUrl}/player/index.php?data=${videoId}&do=getVideo`;
        
        const response = await axios.post(apiUrl, 
            new URLSearchParams({ 
                'hash': videoId, 
                'r': 'https://animesalt.top'  // MUST be exact string, not BASE_URL variable
            }).toString(), 
            {
                headers: {
                    ...BASE_HEADERS,
                    'Referer': iframeSrc,
                    'x-requested-with': 'XMLHttpRequest',
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        if (response.data && response.data.videoSource) {
            return res.json({
                url: response.data.videoSource,
                type: "hls",
                headers: {
                    "Referer": baseUrl,
                    "User-Agent": BASE_HEADERS['User-Agent']
                }
            });
        } else {
            throw new Error("No video source returned from API");
        }
    } catch (err) {
        console.error("Video Extraction Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server secure & running at http://localhost:${PORT}`));