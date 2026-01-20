const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// Custom headers to mimic a real browser/Cloudstream request
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

app.get('/api/extract', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: "Missing URL" });

    try {
        // 1. Load Episode Page (Animesalt.kt logic)
        const { data: pageHtml } = await axios.get(targetUrl, { headers: BASE_HEADERS });
        const $ = cheerio.load(pageHtml);
        
        // Find iframe in #options-0
        const iframeSrc = $('#options-0 iframe').attr('data-src') || $('iframe[src*="as-cdn"]').attr('src');
        if (!iframeSrc) throw new Error("Video player not found on page");

        const urlObj = new URL(iframeSrc);
        const videoId = urlObj.pathname.split('/').pop();
        const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

        // 2. Call Player API (AWSStream/ascdn21 logic from Extractor.kt)
        const apiUrl = `${baseUrl}/player/index.php?data=${videoId}&do=getVideo`;
        
        const response = await axios.post(apiUrl, 
            new URLSearchParams({
                'hash': videoId,
                'r': "https://animesalt.top" // Referer parameter required
            }).toString(), 
            {
                headers: {
                    ...BASE_HEADERS,
                    'Referer': iframeSrc,
                    'x-requested-with': 'XMLHttpRequest', // Mandatory header
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        // 3. Process Response
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
            throw new Error("CDN did not return a valid videoSource");
        }

    } catch (err) {
        console.error("Extraction Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));